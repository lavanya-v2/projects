/**
 * API seed helpers for e2e tests.
 * Creates and tears down test data via the backend REST API so tests are
 * not skipped due to an empty dev database.
 *
 * Backend runs at http://localhost:3000 (or the BACKEND_URL env var).
 * All seed records are tagged with the title prefix "[E2E-TEST]" so they
 * are easy to identify and clean up even if teardown is skipped.
 *
 * Orphan protection: each created ID is immediately written to a temp file
 * (/tmp/dsr-e2e-seeds.json). The global teardown reads this file and deletes
 * any remaining records, so even a SIGKILL or mid-run crash won't leave
 * test data in the live database permanently.
 */

import * as fs from 'fs';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
const SUPERUSER_CREDS = { userId: 'superuser', password: 'V2CCMH@superUser' };

/** Path to the persistent seed state file shared across all test workers. */
export const SEED_STATE_FILE = '/tmp/dsr-e2e-seeds.json';

interface SeedState {
    token: string;
    ids: number[];
}

export interface SeedRisk {
    id: number;
    title: string;
}

// ---------------------------------------------------------------------------
// Seed state file helpers
// ---------------------------------------------------------------------------

function readSeedState(): SeedState {
    try {
        if (fs.existsSync(SEED_STATE_FILE)) {
            return JSON.parse(fs.readFileSync(SEED_STATE_FILE, 'utf-8')) as SeedState;
        }
    } catch { /* ignore malformed file */ }
    return { token: '', ids: [] };
}

function writeSeedState(state: SeedState): void {
    try {
        fs.writeFileSync(SEED_STATE_FILE, JSON.stringify(state), 'utf-8');
    } catch (err) {
        console.warn('[seed] Could not write seed state file:', err);
    }
}

/** Append created IDs to the persistent state file immediately after creation. */
export function appendSeedState(token: string, ids: number[]): void {
    const existing = readSeedState();
    writeSeedState({
        token: token || existing.token,
        ids: [...new Set([...existing.ids, ...ids])],
    });
}

/** Remove successfully-deleted IDs from the persistent state file. */
export function removeSeedState(ids: number[]): void {
    const existing = readSeedState();
    const removed = new Set(ids);
    writeSeedState({
        token: existing.token,
        ids: existing.ids.filter(id => !removed.has(id)),
    });
}

// ---------------------------------------------------------------------------
// Core seed / teardown API
// ---------------------------------------------------------------------------

/** Get a JWT for the superuser account. */
export async function getSuperuserToken(): Promise<string> {
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(SUPERUSER_CREDS),
    });
    if (!res.ok) {
        throw new Error(`Login failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json() as { token: string };
    return data.token;
}

/**
 * Create a test risk on the board.
 * Returns the created risk's id.
 */
export async function createTestRisk(
    token: string,
    overrides: Partial<{
        title: string;
        priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
        source: 'CLIENT' | 'INTERNAL';
        description: string;
        notifiedDate: string;
    }> = {}
): Promise<SeedRisk> {
    const today = new Date().toISOString().split('T')[0];
    const payload = {
        source: 'INTERNAL',
        notifiedDate: today,
        title: '[E2E-TEST] Seed risk — do not edit',
        description: 'Automatically created by e2e test suite. Will be deleted after test run.',
        priority: 'HIGH',
        ...overrides,
    };

    const res = await fetch(`${BACKEND_URL}/api/risks`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        throw new Error(`Create risk failed: ${res.status} ${await res.text()}`);
    }

    const body = await res.json() as { success: boolean; data: { id: number; title: string } };
    return { id: body.data.id, title: body.data.title };
}

/** Delete a test risk by id. Non-fatal — logs on error. */
export async function deleteTestRisk(token: string, id: number): Promise<void> {
    try {
        const res = await fetch(`${BACKEND_URL}/api/risks/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            console.warn(`[seed] Failed to delete risk ${id}: ${res.status}`);
        }
    } catch (err) {
        console.warn(`[seed] Error deleting risk ${id}:`, err);
    }
}

/** Create multiple test risks and return their ids. */
export async function seedRisks(count = 2): Promise<{ token: string; ids: number[] }> {
    const token = await getSuperuserToken();
    const ids: number[] = [];

    const priorities: Array<'CRITICAL' | 'HIGH' | 'MEDIUM'> = ['CRITICAL', 'HIGH', 'MEDIUM'];
    for (let i = 0; i < count; i++) {
        const risk = await createTestRisk(token, {
            title: `[E2E-TEST] Seed risk ${i + 1}`,
            priority: priorities[i % priorities.length],
        });
        ids.push(risk.id);
        // Track immediately so a mid-seed crash still records this ID
        appendSeedState(token, [risk.id]);
    }

    return { token, ids };
}

/** Delete all given risk ids and remove them from the persistent state file. */
export async function teardownRisks(token: string, ids: number[]): Promise<void> {
    await Promise.all(ids.map(id => deleteTestRisk(token, id)));
    // Remove from state file regardless of individual delete success —
    // if a risk no longer exists in the DB it doesn't need tracking.
    removeSeedState(ids);
}

// ---------------------------------------------------------------------------
// Orphan cleanup
// ---------------------------------------------------------------------------

/**
 * Delete any test risks left over from a previous crashed run.
 * Call this at the START of beforeAll, before seeding new data.
 */
export async function cleanupOrphanedSeeds(): Promise<void> {
    const state = readSeedState();
    if (!state.token || state.ids.length === 0) return;
    try {
        console.log(`[seed] Cleaning up ${state.ids.length} orphaned seed record(s) from previous run...`);
        await teardownRisks(state.token, state.ids);
        console.log('[seed] Orphan cleanup complete.');
    } catch (err) {
        console.warn('[seed] Orphan cleanup warning:', err);
    }
}
