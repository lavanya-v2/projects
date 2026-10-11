/**
 * Helpers for the Risk RBAC E2E test suite.
 *
 * - Per-role JWT login (cached) for: superuser, admin, manager1, manager2, lead1, lead2, member.
 * - Idempotent provisioning of two extra "second" users (manager2, lead2) so the suite
 *   can test "same rank, different user" denial cases that need two managers and two leads.
 * - Thin REST wrappers around the /api/risks endpoints, returning { status, data }.
 * - Fixture orchestration: setupRbacFixtures() creates 8 risks across roles + visibility cases.
 * - Persistent seed-state file (/tmp/dsr-e2e-rbac-seeds.json) so a mid-run crash leaves a
 *   recoverable record for the next run's orphan cleanup.
 *
 * All risks created by this suite are tagged with the title prefix "[E2E-RBAC]".
 * The extra users created are "manager2@v2solutions.com" and "lead2@v2solutions.com".
 */

import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
export const RBAC_SEED_FILE = '/tmp/dsr-e2e-rbac-seeds.json';

/**
 * Read the backend's .env file to get DB credentials. We need direct DB
 * access for hard cleanup because /api/users/:id only deactivates (soft delete).
 */
function getDbConfig(): { host: string; port: number; database: string; user: string; password: string } {
    const envPath = path.resolve(__dirname, '../../backend/.env');
    if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
        const env: Record<string, string> = {};
        for (const line of lines) {
            const m = line.match(/^([^#=]+)=(.*)$/);
            if (m) env[m[1].trim()] = m[2].trim();
        }
        return {
            host: env.DB_HOST || 'localhost',
            port: parseInt(env.DB_PORT || '5432'),
            database: env.DB_NAME || 'jira_daily_reports',
            user: env.DB_USER || 'postgres',
            password: env.DB_PASSWORD || 'postgres',
        };
    }
    return { host: 'localhost', port: 5432, database: 'jira_daily_reports', user: 'postgres', password: 'postgres' };
}

/**
 * Hard-delete risks matching a title prefix and the manager2/lead2 test users
 * from the database directly. This is the safety-net cleanup used by both the
 * in-test teardown and orphan recovery — needed because the user API only
 * soft-deletes.
 *
 * The title prefix is parameterized so different test files can use distinct
 * prefixes (e.g. `[E2E-RBAC]` vs `[E2E-RBAC-UI]`) and avoid cross-deleting
 * each other's data when running in parallel workers.
 *
 * Extra users are NOT deleted unless `deleteExtraUsers` is true — they are
 * shared between the API and UI suites and only the LAST suite to finish
 * should remove them. The global teardown also cleans them up as a safety net.
 */
async function dbHardCleanup(titlePrefix: string, deleteExtraUsers: boolean): Promise<void> {
    const db = new Client(getDbConfig());
    try {
        await db.connect();

        // 1. Risks matching this suite's prefix: delete dependents first.
        const likePattern = `${titlePrefix}%`;
        await db.query(`DELETE FROM risk_comments WHERE risk_id IN (SELECT id FROM risks WHERE title LIKE $1)`, [likePattern]);
        await db.query(`DELETE FROM risk_mitigation_plans WHERE risk_id IN (SELECT id FROM risks WHERE title LIKE $1)`, [likePattern]);
        const riskDel = await db.query(`DELETE FROM risks WHERE title LIKE $1`, [likePattern]);

        let userDbIds: number[] = [];
        if (deleteExtraUsers) {
            const extraUserIds = ['manager2@v2solutions.com', 'lead2@v2solutions.com'];
            const userRows = await db.query(`SELECT id FROM users WHERE user_id = ANY($1)`, [extraUserIds]);
            userDbIds = userRows.rows.map((r: any) => r.id);
            if (userDbIds.length > 0) {
                // Defensive: also delete any risks (any prefix) created/assigned to these users
                await db.query(`DELETE FROM risk_comments WHERE user_id = ANY($1)`, [userDbIds]);
                await db.query(`DELETE FROM risks WHERE creator_id = ANY($1) OR assignee_id = ANY($1)`, [userDbIds]);
                await db.query(`DELETE FROM user_roles WHERE user_id = ANY($1)`, [userDbIds]);
                await db.query(`DELETE FROM user_permissions WHERE user_id = ANY($1)`, [userDbIds]);
                await db.query(`DELETE FROM users WHERE id = ANY($1)`, [userDbIds]);
            }
        }

        if ((riskDel.rowCount ?? 0) > 0 || userDbIds.length > 0) {
            console.log(`[rbac] DB hard-cleanup (${titlePrefix}): ${riskDel.rowCount ?? 0} risks${deleteExtraUsers ? `, ${userDbIds.length} extra users` : ''}`);
        }
    } catch (err) {
        console.warn('[rbac] DB hard-cleanup error:', err);
    } finally {
        try { await db.end(); } catch { /* ignore */ }
    }
}

const SUPERUSER_CREDS = { userId: 'superuser', password: 'V2CCMH@superUser' };
const ADMIN_CREDS = { userId: 'admin@v2solutions.com', password: 'password123' };
const MANAGER1_CREDS = { userId: 'manager@v2solutions.com', password: 'password123' };
const MANAGER2_CREDS = { userId: 'manager2@v2solutions.com', password: 'password123' };
const LEAD1_CREDS = { userId: 'lead@v2solutions.com', password: 'password123' };
const LEAD2_CREDS = { userId: 'lead2@v2solutions.com', password: 'password123' };
const MEMBER_CREDS = { userId: 'member@v2solutions.com', password: 'password123' };

export type RbacRole = 'superuser' | 'admin' | 'manager1' | 'manager2' | 'lead1' | 'lead2' | 'member';

const CREDS_BY_ROLE: Record<RbacRole, { userId: string; password: string }> = {
    superuser: SUPERUSER_CREDS,
    admin: ADMIN_CREDS,
    manager1: MANAGER1_CREDS,
    manager2: MANAGER2_CREDS,
    lead1: LEAD1_CREDS,
    lead2: LEAD2_CREDS,
    member: MEMBER_CREDS,
};

// ---------------------------------------------------------------------------
// Persistent seed file (orphan recovery)
// ---------------------------------------------------------------------------

interface RbacSeedState {
    superuserToken: string;
    riskIds: number[];
    extraUserIds: number[];  // manager2, lead2 user-table ids
}

function readRbacSeedState(): RbacSeedState {
    try {
        if (fs.existsSync(RBAC_SEED_FILE)) {
            return JSON.parse(fs.readFileSync(RBAC_SEED_FILE, 'utf-8')) as RbacSeedState;
        }
    } catch { /* malformed file — ignore */ }
    return { superuserToken: '', riskIds: [], extraUserIds: [] };
}

function writeRbacSeedState(state: RbacSeedState): void {
    try {
        fs.writeFileSync(RBAC_SEED_FILE, JSON.stringify(state), 'utf-8');
    } catch (err) {
        console.warn('[rbac-seed] Could not write seed state file:', err);
    }
}

export function appendRbacRiskIds(superuserToken: string, ids: number[]): void {
    const existing = readRbacSeedState();
    writeRbacSeedState({
        superuserToken: superuserToken || existing.superuserToken,
        riskIds: [...new Set([...existing.riskIds, ...ids])],
        extraUserIds: existing.extraUserIds,
    });
}

export function appendRbacExtraUserIds(superuserToken: string, ids: number[]): void {
    const existing = readRbacSeedState();
    writeRbacSeedState({
        superuserToken: superuserToken || existing.superuserToken,
        riskIds: existing.riskIds,
        extraUserIds: [...new Set([...existing.extraUserIds, ...ids])],
    });
}

function clearRbacSeedFile(): void {
    try { if (fs.existsSync(RBAC_SEED_FILE)) fs.unlinkSync(RBAC_SEED_FILE); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Login + token cache
// ---------------------------------------------------------------------------

const tokenCache: Partial<Record<RbacRole, string>> = {};

export async function loginAsRole(role: RbacRole): Promise<string> {
    if (tokenCache[role]) return tokenCache[role]!;

    const creds = CREDS_BY_ROLE[role];
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
    });

    if (!res.ok) {
        throw new Error(`Login failed for role ${role} (${creds.userId}): ${res.status} ${await res.text()}`);
    }

    const data = await res.json() as { token: string };
    tokenCache[role] = data.token;
    return data.token;
}

export function clearTokenCache(): void {
    for (const k of Object.keys(tokenCache)) delete tokenCache[k as RbacRole];
}

// ---------------------------------------------------------------------------
// REST wrappers for /api/risks
// ---------------------------------------------------------------------------

interface ApiResponse<T = any> {
    status: number;
    ok: boolean;
    data: T | null;
    error?: string;
}

async function apiCall<T = any>(
    method: string,
    path: string,
    token: string,
    body?: any
): Promise<ApiResponse<T>> {
    const res = await fetch(`${BACKEND_URL}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    let parsed: any = null;
    let err: string | undefined;
    try {
        const text = await res.text();
        if (text) parsed = JSON.parse(text);
    } catch { /* non-JSON response */ }

    if (!res.ok && parsed?.error) err = parsed.error;

    return {
        status: res.status,
        ok: res.ok,
        data: parsed?.data ?? parsed,
        error: err,
    };
}

export interface CreateRiskPayload {
    source?: 'CLIENT' | 'INTERNAL';
    notifiedDate?: string;
    title?: string;
    description?: string;
    priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    assigneeId?: number | null;
    projectId?: number | null;
}

export async function listRisks(token: string): Promise<ApiResponse<any[]>> {
    return apiCall('GET', '/api/risks', token);
}

export async function getRisk(token: string, id: number): Promise<ApiResponse<any>> {
    return apiCall('GET', `/api/risks/${id}`, token);
}

export async function createRisk(token: string, payload: CreateRiskPayload = {}): Promise<ApiResponse<any>> {
    const body = {
        source: 'INTERNAL',
        notifiedDate: new Date().toISOString().split('T')[0],
        title: '[E2E-RBAC] Test risk',
        description: 'Created by RBAC e2e test suite',
        priority: 'MEDIUM',
        ...payload,
    };
    return apiCall('POST', '/api/risks', token, body);
}

export async function updateRisk(token: string, id: number, body: any): Promise<ApiResponse<any>> {
    return apiCall('PUT', `/api/risks/${id}`, token, body);
}

export async function deleteRisk(token: string, id: number): Promise<ApiResponse<any>> {
    return apiCall('DELETE', `/api/risks/${id}`, token);
}

export async function transitionStatus(
    token: string,
    id: number,
    status: string,
    comment: string
): Promise<ApiResponse<any>> {
    return apiCall('PUT', `/api/risks/${id}/status`, token, { status, comment });
}

export async function markDone(token: string, id: number, resolution: string): Promise<ApiResponse<any>> {
    return apiCall('PUT', `/api/risks/${id}/done`, token, { resolution });
}

export async function addComment(token: string, id: number, comment: string): Promise<ApiResponse<any>> {
    return apiCall('POST', `/api/risks/${id}/comments`, token, { comment });
}

export async function addMitigationPlan(
    token: string,
    id: number,
    description: string
): Promise<ApiResponse<any>> {
    return apiCall('POST', `/api/risks/${id}/mitigation-plans`, token, { description });
}

export async function deleteMitigationPlan(
    token: string,
    riskId: number,
    planId: number
): Promise<ApiResponse<any>> {
    return apiCall('DELETE', `/api/risks/${riskId}/mitigation-plans/${planId}`, token);
}

// ---------------------------------------------------------------------------
// Discover account/project
// ---------------------------------------------------------------------------

async function discoverAccountAndProject(superuserToken: string): Promise<{ accountId: number; projectId: number }> {
    const accountsRes = await apiCall('GET', '/api/accounts', superuserToken);
    const accounts: any[] = accountsRes.data ?? [];
    if (!accounts.length) throw new Error('[rbac] No accounts in DB; cannot run RBAC suite');
    const accountId = accounts[0].id;

    const projectsRes = await apiCall('GET', '/api/projects', superuserToken);
    const projects: any[] = projectsRes.data ?? [];
    const projectInAccount = projects.find(p => p.accountId === accountId) ?? projects[0];
    if (!projectInAccount) throw new Error('[rbac] No projects in DB; cannot run RBAC suite');

    return { accountId, projectId: projectInAccount.id };
}

// ---------------------------------------------------------------------------
// Extra user provisioning (manager2, lead2) — idempotent
// ---------------------------------------------------------------------------

async function ensureUser(
    superuserToken: string,
    creds: { userId: string; password: string },
    firstName: string,
    lastName: string,
    roleName: 'manager' | 'lead',
    accountId: number,
    projectId: number
): Promise<number> {
    // First check if the user already exists (covers both happy path AND
    // races where another worker created it concurrently). The user list
    // includes deactivated users.
    const existingLookup = await apiCall<any[]>('GET', '/api/users', superuserToken);
    const existing = (existingLookup.data ?? []).find((u: any) => u.userId === creds.userId);
    if (existing?.id) return existing.id;

    const body = {
        userId: creds.userId,
        firstName,
        lastName,
        password: creds.password,
        roleName,
        // Single-project access (matches existing manager1/lead1 setup)
        permissions: [{ accountId, projectIds: [projectId] }],
    };

    const res = await apiCall<{ id: number }>('POST', '/api/users', superuserToken, body);

    if (res.status === 201) {
        return (res.data as any)?.id;
    }

    // Race fallback: if the create lost a race, look the user up again.
    if (res.status === 400 || res.status === 500) {
        const retry = await apiCall<any[]>('GET', '/api/users', superuserToken);
        const found = (retry.data ?? []).find((u: any) => u.userId === creds.userId);
        if (found?.id) return found.id;
    }

    throw new Error(`[rbac] Failed to provision ${creds.userId}: ${res.status} ${res.error ?? ''}`);
}

export async function ensureExtraUsers(
    superuserToken: string,
    accountId: number,
    projectId: number
): Promise<{ manager2Id: number; lead2Id: number }> {
    const manager2Id = await ensureUser(superuserToken, MANAGER2_CREDS, 'E2E', 'Manager2', 'manager', accountId, projectId);
    const lead2Id = await ensureUser(superuserToken, LEAD2_CREDS, 'E2E', 'Lead2', 'lead', accountId, projectId);

    appendRbacExtraUserIds(superuserToken, [manager2Id, lead2Id]);
    return { manager2Id, lead2Id };
}

// ---------------------------------------------------------------------------
// Fixture orchestration
// ---------------------------------------------------------------------------

export interface RbacFixtures {
    accountId: number;
    projectId: number;
    tokens: Record<RbacRole, string>;
    extraUserIds: { manager2: number; lead2: number };
    /** Title prefix used for all risks created by this fixture set. */
    titlePrefix: string;
    risks: {
        riskBySu: number;
        riskBySuUnlinked: number;
        riskByAdmin: number;
        riskByAdminUnlinked: number;
        riskByMgr1: number;
        riskByMgr2: number;
        riskByLead1: number;
        riskByLead2: number;
    };
    /** All risk ids created during the test run, for teardown. */
    createdRiskIds: number[];
}

async function createTrackedRisk(
    creatorToken: string,
    superuserToken: string,
    payload: CreateRiskPayload,
    label: string
): Promise<number> {
    const res = await createRisk(creatorToken, payload);
    if (!res.ok || !res.data?.id) {
        throw new Error(`[rbac] Failed to create fixture risk ${label}: ${res.status} ${res.error ?? ''}`);
    }
    const id = res.data.id;
    appendRbacRiskIds(superuserToken, [id]);
    return id;
}

export async function setupRbacFixtures(titlePrefix = '[E2E-RBAC]'): Promise<RbacFixtures> {
    // 0. Orphan cleanup from any previous crashed run BEFORE creating new data.
    //    Only cleans risks under THIS prefix; extra users are cleaned only if
    //    they have no other [E2E-RBAC*] risks left (handled by teardown).
    await dbHardCleanup(titlePrefix, false);
    clearRbacSeedFile();

    // 1. Login as all roles. Superuser must come first to provision extras.
    const superuserToken = await loginAsRole('superuser');

    // 2. Discover account + project (uses same shared project as global-setup).
    const { accountId, projectId } = await discoverAccountAndProject(superuserToken);

    // 3. Provision extra users (manager2, lead2). Idempotent — if another
    //    test file already created them, this returns the existing IDs.
    const { manager2Id, lead2Id } = await ensureExtraUsers(superuserToken, accountId, projectId);

    // 4. Login as remaining roles (token cache means subsequent calls are free).
    const tokens: Record<RbacRole, string> = {
        superuser: superuserToken,
        admin: await loginAsRole('admin'),
        manager1: await loginAsRole('manager1'),
        manager2: await loginAsRole('manager2'),
        lead1: await loginAsRole('lead1'),
        lead2: await loginAsRole('lead2'),
        member: await loginAsRole('member'),
    };

    // 5. Seed the 8 fixture risks.
    const riskBySu = await createTrackedRisk(
        tokens.superuser, superuserToken,
        { projectId, title: `${titlePrefix} By superuser (linked)` },
        'riskBySu'
    );
    const riskBySuUnlinked = await createTrackedRisk(
        tokens.superuser, superuserToken,
        { title: `${titlePrefix} By superuser (unlinked)` },
        'riskBySuUnlinked'
    );
    const riskByAdmin = await createTrackedRisk(
        tokens.admin, superuserToken,
        { projectId, title: `${titlePrefix} By admin (linked)` },
        'riskByAdmin'
    );
    const riskByAdminUnlinked = await createTrackedRisk(
        tokens.admin, superuserToken,
        { title: `${titlePrefix} By admin (unlinked)` },
        'riskByAdminUnlinked'
    );
    const riskByMgr1 = await createTrackedRisk(
        tokens.manager1, superuserToken,
        { projectId, title: `${titlePrefix} By manager1` },
        'riskByMgr1'
    );
    const riskByMgr2 = await createTrackedRisk(
        tokens.manager2, superuserToken,
        { projectId, title: `${titlePrefix} By manager2` },
        'riskByMgr2'
    );
    const riskByLead1 = await createTrackedRisk(
        tokens.lead1, superuserToken,
        { projectId, title: `${titlePrefix} By lead1` },
        'riskByLead1'
    );
    const riskByLead2 = await createTrackedRisk(
        tokens.lead2, superuserToken,
        { projectId, title: `${titlePrefix} By lead2` },
        'riskByLead2'
    );

    const createdRiskIds = [
        riskBySu, riskBySuUnlinked,
        riskByAdmin, riskByAdminUnlinked,
        riskByMgr1, riskByMgr2,
        riskByLead1, riskByLead2,
    ];

    return {
        accountId,
        projectId,
        tokens,
        extraUserIds: { manager2: manager2Id, lead2: lead2Id },
        titlePrefix,
        risks: {
            riskBySu, riskBySuUnlinked,
            riskByAdmin, riskByAdminUnlinked,
            riskByMgr1, riskByMgr2,
            riskByLead1, riskByLead2,
        },
        createdRiskIds,
    };
}

/**
 * Track an additional risk created during a test (e.g. Suite C creation tests
 * or disposable risks for Suite I delete tests). Ensures it gets cleaned up.
 */
export function trackExtraRisk(fixtures: RbacFixtures, id: number): void {
    fixtures.createdRiskIds.push(id);
    appendRbacRiskIds(fixtures.tokens.superuser, [id]);
}

export async function teardownRbacFixtures(fixtures: RbacFixtures): Promise<void> {
    // Hard-delete only this suite's risks (scoped by title prefix). The extra
    // users (manager2/lead2) are NOT deleted here — they may be in use by
    // another spec file running in parallel. The global teardown deletes them
    // at the end of the entire playwright invocation.
    await dbHardCleanup(fixtures.titlePrefix, false);

    clearRbacSeedFile();
    clearTokenCache();
}

/**
 * Recover from a crashed previous run. Uses DB hard cleanup directly — catches
 * everything by title/email pattern regardless of whether the seed file is
 * accurate. Called automatically by setupRbacFixtures() before creating new
 * fixtures. Optional title prefix lets callers scope the cleanup.
 */
export async function cleanupOrphanedRbacSeeds(titlePrefix = '[E2E-RBAC]'): Promise<void> {
    await dbHardCleanup(titlePrefix, false);
    clearRbacSeedFile();
}
