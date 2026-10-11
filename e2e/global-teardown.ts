/**
 * Playwright global teardown — HARD DELETES all E2E test data from DB.
 */
import { teardownRisks, SEED_STATE_FILE } from './tests/api-seed';
import * as fs from 'fs';
import { Client } from 'pg';

const E2E_STATE_FILE = '/tmp/dsr-e2e-state.json';

function getDbConfig() {
    // Read from backend .env
    const envPath = require('path').resolve(__dirname, '../backend/.env');
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

const TEST_USER_IDS = [
    'admin@v2solutions.com',
    'manager@v2solutions.com',
    'manager2@v2solutions.com',
    'lead@v2solutions.com',
    'lead2@v2solutions.com',
    'member@v2solutions.com',
];

export default async function globalTeardown() {
    // 1. Risk seed cleanup
    if (fs.existsSync(SEED_STATE_FILE)) {
        try {
            const raw = fs.readFileSync(SEED_STATE_FILE, 'utf-8');
            const state = JSON.parse(raw) as { token: string; ids: number[] };
            if (state.token && state.ids?.length > 0) {
                await teardownRisks(state.token, state.ids);
            }
            fs.unlinkSync(SEED_STATE_FILE);
        } catch (err) {
            console.warn('[teardown] Risk cleanup warning:', err);
            try { fs.unlinkSync(SEED_STATE_FILE); } catch { /* ignore */ }
        }
    }

    // 2. Hard delete all E2E test data via direct DB
    const db = new Client(getDbConfig());
    try {
        await db.connect();
        console.log('[teardown] Connected to DB. Hard-deleting E2E test data...');

        // Delete RBAC test risks (any title starting with [E2E-RBAC) and their dependents.
        // Covers both [E2E-RBAC] (api spec) and [E2E-RBAC-UI] (ui spec) prefixes.
        await db.query(`DELETE FROM risk_comments WHERE risk_id IN (SELECT id FROM risks WHERE title LIKE '[E2E-RBAC%')`);
        await db.query(`DELETE FROM risk_mitigation_plans WHERE risk_id IN (SELECT id FROM risks WHERE title LIKE '[E2E-RBAC%')`);
        const rbacRiskDel = await db.query(`DELETE FROM risks WHERE title LIKE '[E2E-RBAC%'`);
        if ((rbacRiskDel.rowCount ?? 0) > 0) console.log(`  [-] Deleted ${rbacRiskDel.rowCount} [E2E-RBAC*] risks`);

        // Delete any remaining risks created by the test users (defensive — these
        // would block user deletion via the FK constraint).
        await db.query(`DELETE FROM risk_comments WHERE risk_id IN (SELECT r.id FROM risks r JOIN users u ON u.id = r.creator_id WHERE u.user_id = ANY($1))`, [TEST_USER_IDS]);
        await db.query(`DELETE FROM risk_mitigation_plans WHERE risk_id IN (SELECT r.id FROM risks r JOIN users u ON u.id = r.creator_id WHERE u.user_id = ANY($1))`, [TEST_USER_IDS]);
        const orphanRiskDel = await db.query(`DELETE FROM risks WHERE creator_id IN (SELECT id FROM users WHERE user_id = ANY($1))`, [TEST_USER_IDS]);
        if ((orphanRiskDel.rowCount ?? 0) > 0) console.log(`  [-] Deleted ${orphanRiskDel.rowCount} risks orphaned to test users`);

        // Delete action items tagged [E2E-TEST] and their related data
        await db.query(`DELETE FROM action_item_comments WHERE action_item_id IN (SELECT id FROM project_action_items WHERE title LIKE '[E2E-TEST]%')`);
        await db.query(`DELETE FROM action_item_comments WHERE account_action_item_id IN (SELECT id FROM account_action_items WHERE title LIKE '[E2E-TEST]%')`);
        await db.query(`DELETE FROM biweekly_action_items WHERE action_item_id IN (SELECT id FROM project_action_items WHERE title LIKE '[E2E-TEST]%')`);
        await db.query(`DELETE FROM action_item_status_history WHERE action_item_id IN (SELECT id FROM project_action_items WHERE title LIKE '[E2E-TEST]%')`);
        await db.query(`DELETE FROM action_item_status_history WHERE account_action_item_id IN (SELECT id FROM account_action_items WHERE title LIKE '[E2E-TEST]%')`);
        const aiDel = await db.query(`DELETE FROM project_action_items WHERE title LIKE '[E2E-TEST]%'`);
        const acctAiDel = await db.query(`DELETE FROM account_action_items WHERE title LIKE '[E2E-TEST]%'`);
        console.log(`  [-] Deleted ${aiDel.rowCount} project AIs, ${acctAiDel.rowCount} account AIs`);

        // Hard delete test users and their related data
        const userRows = await db.query(`SELECT id FROM users WHERE user_id = ANY($1)`, [TEST_USER_IDS]);
        const userDbIds = userRows.rows.map((r: any) => r.id);
        if (userDbIds.length > 0) {
            await db.query(`DELETE FROM user_roles WHERE user_id = ANY($1)`, [userDbIds]);
            await db.query(`DELETE FROM user_permissions WHERE user_id = ANY($1)`, [userDbIds]);
            const del = await db.query(`DELETE FROM users WHERE id = ANY($1)`, [userDbIds]);
            console.log(`  [-] Hard-deleted ${del.rowCount} test users`);
        }

        console.log('[teardown] Done.');
    } catch (err) {
        console.warn('[teardown] DB cleanup error:', err);
    } finally {
        await db.end();
    }

    // Clean up state file
    try { if (fs.existsSync(E2E_STATE_FILE)) fs.unlinkSync(E2E_STATE_FILE); } catch { /* ignore */ }
}
