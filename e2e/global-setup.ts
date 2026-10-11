/**
 * Playwright global setup — seeds ALL test data before tests run.
 * Creates test users, action items (open, closed, discarded), and comments.
 * Uses the backend REST API. All data is torn down in global-teardown.ts.
 */

import * as fs from 'fs';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
const SUPERUSER_CREDS = { userId: 'superuser', password: 'V2CCMH@superUser' };
export const E2E_STATE_FILE = '/tmp/dsr-e2e-state.json';

const TEST_USERS = [
    { userId: 'admin@v2solutions.com', firstName: 'E2E', lastName: 'Admin', password: 'password123', roleName: 'admin', fullAccountAccess: true },
    { userId: 'manager@v2solutions.com', firstName: 'E2E', lastName: 'Manager', password: 'password123', roleName: 'manager', fullAccountAccess: false },
    { userId: 'lead@v2solutions.com', firstName: 'E2E', lastName: 'Lead', password: 'password123', roleName: 'lead', fullAccountAccess: false },
    { userId: 'member@v2solutions.com', firstName: 'E2E', lastName: 'Member', password: 'password123', roleName: 'member', fullAccountAccess: false },
];

interface E2EState {
    token: string;
    projectId: number | null;
    accountId: number | null;
    userIds: number[];
    actionItemIds: number[];
    accountActionItemIds: number[];
    commentIds: number[];
}

function writeState(state: E2EState) {
    fs.writeFileSync(E2E_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

async function apiGet(url: string, token: string) {
    const res = await fetch(`${BACKEND_URL}${url}`, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok ? res.json() : null;
}

async function apiPost(url: string, token: string, body: any) {
    const res = await fetch(`${BACKEND_URL}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : null };
}

async function apiPut(url: string, token: string, body: any) {
    const res = await fetch(`${BACKEND_URL}${url}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : null };
}

export default async function globalSetup() {
    console.log('[globalSetup] Seeding E2E test data...');

    const state: E2EState = { token: '', projectId: null, accountId: null, userIds: [], actionItemIds: [], accountActionItemIds: [], commentIds: [] };

    // 1. Login as superuser
    let token: string;
    try {
        const loginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(SUPERUSER_CREDS),
        });
        if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);
        const loginData = await loginRes.json() as { token: string };
        token = loginData.token;
        state.token = token;
    } catch (err) {
        console.warn('[globalSetup] Could not authenticate. Skipping seed.', err);
        writeState(state);
        return;
    }

    // 2. Find first account and project
    const acctData = await apiGet('/api/accounts', token);
    const accounts = acctData?.data ?? acctData ?? [];
    if (accounts.length > 0) {
        state.accountId = accounts[0].id;
    }

    const projData = await apiGet('/api/projects', token);
    const projects = projData?.data ?? projData ?? [];
    if (projects.length > 0) {
        const firstProj = state.accountId
            ? projects.find((p: any) => p.accountId === state.accountId) ?? projects[0]
            : projects[0];
        state.projectId = firstProj.id;
    }

    // 3. Seed test users (idempotent — if user already exists, reset their
    //    password + roleName + permissions so subsequent runs don't fail with
    //    stale credentials from a previous broken state).
    const existingUsersList = await apiGet('/api/users', token);
    const existingUsers: any[] = existingUsersList?.data ?? existingUsersList ?? [];

    for (const user of TEST_USERS) {
        const permissions = state.accountId
            ? [{ accountId: state.accountId, projectIds: user.fullAccountAccess ? [] : (state.projectId ? [state.projectId] : []) }]
            : [];

        const res = await apiPost('/api/users', token, {
            userId: user.userId,
            firstName: user.firstName,
            lastName: user.lastName,
            password: user.password,
            roleName: user.roleName,
            permissions,
        });

        if (res.ok && res.data?.data?.id) {
            state.userIds.push(res.data.data.id);
            console.log(`  [+] Created ${user.roleName}: ${user.userId} (id=${res.data.data.id})`);
        } else if (res.status === 400) {
            // User already exists from a prior run — reset password + role to known-good state
            const existing = existingUsers.find((u: any) => u.userId === user.userId);
            if (existing?.id) {
                const updateRes = await apiPut(`/api/users/${existing.id}`, token, {
                    firstName: user.firstName,
                    lastName: user.lastName,
                    password: user.password,
                    roleName: user.roleName,
                    isActive: true,
                    permissions,
                });
                if (updateRes.ok) {
                    console.log(`  [~] Reset existing ${user.roleName}: ${user.userId} (id=${existing.id})`);
                } else {
                    console.warn(`  [!] Could not reset existing ${user.userId}: ${updateRes.status}`);
                }
            } else {
                console.warn(`  [!] ${user.userId} reported as existing but not found in list`);
            }
        } else {
            console.warn(`  [!] Failed to create ${user.userId}: ${res.status}`);
        }
    }

    // 4. Seed project action items (open, closed, discarded) + comment
    if (state.projectId) {
        // Open item
        const openRes = await apiPost(`/api/report/project/${state.projectId}/action-items`, token, {
            title: '[E2E-TEST] Open project item', category: 'Task', owner: 'E2E Test',
        });
        if (openRes.ok) {
            const openId = openRes.data.id;
            state.actionItemIds.push(openId);
            console.log(`  [+] Created open project AI (id=${openId})`);

            // Add a comment to the open item
            const commentRes = await apiPost(`/api/report/action-item/${openId}/comments`, token, { content: '[E2E-TEST] Seed comment' });
            if (commentRes.ok) {
                state.commentIds.push(commentRes.data.id);
                console.log(`  [+] Added comment to project AI (id=${commentRes.data.id})`);
            }
        }

        // Closed item
        const closedRes = await apiPost(`/api/report/project/${state.projectId}/action-items`, token, {
            title: '[E2E-TEST] Closed project item', category: 'Issue', owner: 'E2E Test',
        });
        if (closedRes.ok) {
            const closedId = closedRes.data.id;
            state.actionItemIds.push(closedId);
            await apiPost(`/api/report/action-item/${closedId}/transition`, token, { toStatus: 'Closed', note: 'E2E test closure' });
            console.log(`  [+] Created + closed project AI (id=${closedId})`);
        }

        // Discarded item
        const discardRes = await apiPost(`/api/report/project/${state.projectId}/action-items`, token, {
            title: '[E2E-TEST] Discarded project item', category: 'Task', owner: 'E2E Test',
        });
        if (discardRes.ok) {
            const discardId = discardRes.data.id;
            state.actionItemIds.push(discardId);
            await apiPost(`/api/report/action-item/${discardId}/transition`, token, { toStatus: 'Discarded', note: 'E2E test discard' });
            console.log(`  [+] Created + discarded project AI (id=${discardId})`);
        }
    }

    // 5. Seed account action items (open + closed)
    if (state.accountId) {
        const acctOpenRes = await apiPost(`/api/report/account/${state.accountId}/action-items`, token, {
            title: '[E2E-TEST] Open account item', category: 'Task', owner: 'E2E Test',
        });
        if (acctOpenRes.ok) {
            state.accountActionItemIds.push(acctOpenRes.data.id);
            console.log(`  [+] Created open account AI (id=${acctOpenRes.data.id})`);
        }

        const acctClosedRes = await apiPost(`/api/report/account/${state.accountId}/action-items`, token, {
            title: '[E2E-TEST] Closed account item', category: 'Issue', owner: 'E2E Test',
        });
        if (acctClosedRes.ok) {
            const acctClosedId = acctClosedRes.data.id;
            state.accountActionItemIds.push(acctClosedId);
            await apiPost(`/api/report/account-action-item/${acctClosedId}/transition`, token, { toStatus: 'Closed', note: 'E2E test closure' });
            console.log(`  [+] Created + closed account AI (id=${acctClosedId})`);
        }
    }

    writeState(state);
    console.log(`[globalSetup] Done. State written to ${E2E_STATE_FILE}`);
}
