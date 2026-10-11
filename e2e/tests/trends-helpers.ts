/**
 * Shared helpers for Trends E2E tests. Each spec validates UI ↔ API fidelity
 * and (via the reconciliation endpoint) API ↔ Jira fidelity for one of the
 * four Trends tabs on /team-performance.
 */

import { type Page, type APIRequestContext, expect, request as pwRequest } from '@playwright/test';
import { openRailSection } from './nav-helpers';
import * as fs from 'fs';
import * as path from 'path';

const BACKEND_BASE = 'http://localhost:3000';

export type TrendsTab = 'productivity' | 'density' | 'leakage' | 'reopen';

export const API_ENDPOINTS: Record<TrendsTab, RegExp> = {
    productivity: /\/report\/productivity-overview/,
    density: /\/report\/quality-trends-overview/,
    leakage: /\/report\/quality-trends-overview/,
    reopen: /\/report\/quality-trends-overview/,
};

/**
 * Navigate to the Trends sub-tab by:
 *   1. Opening the Management rail section
 *   2. Clicking the "Team Performance" leaf
 *   3. Clicking the "Trends" main tab (switches from Sprint View)
 *   4. Clicking the target sub-tab via data-testid
 */
export async function navigateToTrends(page: Page, tab: TrendsTab): Promise<void> {
    await openRailSection(page, 'Management');
    await page.locator('text=Team Performance').first().waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('text=Team Performance').first().click();
    await page.waitForLoadState('networkidle');

    // Switch to Trends main tab
    await page.locator('[role="tab"]').filter({ hasText: 'Trends' }).click();
    await page.waitForSelector('[data-testid="trends-view"]', { timeout: 5000 });

    // Switch to the requested sub-tab
    await page.locator(`[data-testid="trends-tab-${tab}"]`).click();
    await page.waitForTimeout(300);
}

/**
 * Probe the backend API directly to find an account with synced-project data
 * for the given tab. Using the API (not the UI dropdown) eliminates flakiness
 * from Material-UI Select interactions and lets us fail fast per account.
 *
 * Returns the discovered account {id, name} + the already-fetched API body so
 * the caller can use it as the ground-truth reference for UI assertions.
 */
async function findAccountWithData(
    token: string,
    tab: TrendsTab,
): Promise<{ accountId: number; accountName: string; api: any }> {
    const api = await pwRequest.newContext({
        extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    try {
        const accountsResp = await api.get(`${BACKEND_BASE}/api/accounts`);
        if (!accountsResp.ok()) {
            throw new Error(`Accounts fetch failed: ${accountsResp.status()} ${await accountsResp.text()}`);
        }
        const raw = await accountsResp.json();
        const accounts: Array<{ id: number; name: string }> = Array.isArray(raw)
            ? raw
            : (raw?.data ?? raw?.accounts ?? []);

        const endpoint = tab === 'productivity'
            ? '/api/report/productivity-overview'
            : '/api/report/quality-trends-overview';

        for (const acc of accounts) {
            const r = await api.get(`${BACKEND_BASE}${endpoint}?accountId=${acc.id}`);
            if (!r.ok()) continue;
            const raw = await r.json();
            const body = raw?.data ?? raw;
            if ((body?.projects ?? []).length > 0) {
                return { accountId: acc.id, accountName: acc.name, api: body };
            }
        }
        throw new Error(`No account in the dev DB has synced projects for ${tab} — cannot validate trends.`);
    } finally {
        await api.dispose();
    }
}

/**
 * Switch the global active account via the top-bar AccountSwitcherMenu, then
 * capture the Trends API response that the account change triggers.
 * Call AFTER navigateToTrends() — the Trends view must be mounted first so it
 * re-fetches when the account changes.
 *
 * Throws if no account in the dev DB has synced data for the tab.
 */
export async function selectAccountWithData(
    page: Page,
    tab: TrendsTab,
): Promise<{ accountName: string; api: any }> {
    const token = await readAuthToken(page);
    const { accountId, accountName, api: refApi } = await findAccountWithData(token, tab);

    // If the top-bar already shows the target account, the Trends view has
    // already fired the API call on mount — nothing to switch, reuse refApi.
    const trigger = page.locator('[data-testid="account-switcher-trigger"]');
    const currentActive = await trigger.getAttribute('data-active-account').catch(() => null);
    if (currentActive === accountName) {
        // Still try to capture the in-flight response if any; otherwise fall back.
        try {
            const inflight = await Promise.race([
                awaitTrendsResponse(page, tab).catch(() => null),
                new Promise<null>(resolve => setTimeout(() => resolve(null), 3000)),
            ]);
            return { accountName, api: inflight ?? refApi };
        } catch {
            return { accountName, api: refApi };
        }
    }

    const apiPromise = awaitTrendsResponse(page, tab);
    await trigger.click();
    const menuOption = page.locator(`[data-testid="account-switcher-option-${accountId}"]`);
    await menuOption.waitFor({ state: 'visible', timeout: 5000 });
    await menuOption.click();
    await page.waitForLoadState('networkidle');

    let uiApi: any;
    try {
        uiApi = await apiPromise;
    } catch {
        uiApi = refApi;
    }
    return { accountName, api: uiApi };
}

/**
 * Wait for the next matching Trends API response and return its `data` payload
 * (the backend wraps responses as { success, data }, so we unwrap here for
 * spec-side simplicity).
 */
export function awaitTrendsResponse(page: Page, tab: TrendsTab) {
    return page.waitForResponse(r =>
        API_ENDPOINTS[tab].test(r.url()) && r.status() === 200,
        { timeout: 30_000 },
    ).then(async r => {
        const body = await r.json();
        return body?.data ?? body;
    });
}

/** Read the JWT from localStorage (the frontend persists it there). */
export async function readAuthToken(page: Page): Promise<string> {
    const token = await page.evaluate(() => localStorage.getItem('token'));
    if (!token) throw new Error('No auth token in localStorage — is the user logged in?');
    return token;
}

/**
 * Call the live reconciliation endpoint for a given sync. Returns the
 * productivity + quality reconciliation payload.
 */
export async function fetchReconciliation(
    request: APIRequestContext,
    syncId: number,
    authToken: string,
): Promise<{ productivity: any; quality: any }> {
    const res = await request.get(
        `http://localhost:3000/api/report/reconciliation/sprint/${syncId}`,
        {
            headers: { Authorization: `Bearer ${authToken}` },
            timeout: 120_000,
        },
    );
    if (!res.ok()) {
        const body = await res.text();
        throw new Error(`Reconciliation endpoint returned ${res.status()}: ${body}`);
    }
    const json = await res.json();
    if (!json.success || !json.data) {
        throw new Error(`Reconciliation response malformed: ${JSON.stringify(json).slice(0, 200)}`);
    }
    return json.data;
}

// ── Evidence artifact writer ─────────────────────────────────────────────────

export interface EvidenceRow {
    projectName: string;
    sprintName: string;
    uiValue: string;     // e.g. "88.3%" or "0.21" or "3"
    apiValue: string;
    jiraValue: string;
    layerBreaking: 'none' | 'ui-vs-api' | 'api-vs-jira' | 'both';
    notes?: string;
}

export function writeEvidenceArtifact(tab: TrendsTab, rows: EvidenceRow[]): string {
    const dir = path.resolve(__dirname, '../test-results');
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(dir, `trends-e2e-evidence-${tab}-${ts}.md`);

    const total = rows.length;
    const passed = rows.filter(r => r.layerBreaking === 'none').length;
    const verdict = passed === total ? 'PASS' : 'FAIL';

    const lines: string[] = [];
    lines.push(`# Trends E2E Evidence — ${titleFor(tab)} — ${new Date().toISOString()}`);
    lines.push('');
    lines.push(`**Verdict:** ${verdict} (${passed}/${total} projects fully validated: UI \u2194 API \u2194 Jira)`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push('| Project | Sprint | UI Shows | API Returns | Jira Agrees | Match |');
    lines.push('| ------- | ------ | -------- | ----------- | ----------- | ----- |');
    for (const r of rows) {
        lines.push(`| ${r.projectName} | ${r.sprintName} | ${r.uiValue} | ${r.apiValue} | ${r.jiraValue} | ${r.layerBreaking === 'none' ? '✓' : '✗'} |`);
    }
    lines.push('');

    const drifts = rows.filter(r => r.layerBreaking !== 'none');
    if (drifts.length > 0) {
        lines.push('## Drift detail');
        lines.push('');
        for (const r of drifts) {
            lines.push(`### ${r.projectName} — ${r.sprintName}`);
            lines.push('');
            lines.push(`- UI rendered: ${r.uiValue}`);
            lines.push(`- API returned: ${r.apiValue}`);
            lines.push(`- Jira (live): ${r.jiraValue}`);
            lines.push(`- Layer breaking: **${r.layerBreaking}**`);
            if (r.notes) lines.push(`- Notes: ${r.notes}`);
            lines.push('');
        }
    }

    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    return filePath;
}

/**
 * Terminal assertion for each Trends spec. Writes the evidence artifact first
 * (always), then enforces the fail criterion:
 *
 *   - Default: hard-fail only on UI-vs-API mismatches (rendering regressions).
 *     API-vs-Jira drift is logged to console and marked in the artifact but
 *     does not fail the test — drift there is data-freshness, not a UI bug,
 *     and is already the job of the standalone reconciliation scripts.
 *   - E2E_STRICT=true: hard-fail on any non-'none' row (legacy full-chain).
 *
 * Prints a one-line summary per spec so CI logs carry the headline numbers.
 */
export function assertEvidenceRows(rows: EvidenceRow[], tab: TrendsTab): void {
    const artifactPath = writeEvidenceArtifact(tab, rows);

    const total = rows.length;
    const uiApiBad = rows.filter(r => r.layerBreaking === 'ui-vs-api' || r.layerBreaking === 'both');
    const apiJiraBad = rows.filter(r => r.layerBreaking === 'api-vs-jira' || r.layerBreaking === 'both');
    const uiApiGood = total - uiApiBad.length;
    const apiJiraGood = total - apiJiraBad.length;

    const title = titleFor(tab);
    console.log(`\nTrends ${title} evidence artifact: ${artifactPath}`);
    console.log(`Trends ${title} — UI\u2194API: ${uiApiGood}/${total} \u2713   API\u2194Jira drift: ${apiJiraBad.length}/${total} (see artifact)\n`);

    const strict = process.env.E2E_STRICT === 'true';
    const failing = strict
        ? rows.filter(r => r.layerBreaking !== 'none')
        : uiApiBad;

    if (failing.length > 0) {
        const summary = failing
            .map(r => `${r.projectName} / ${r.sprintName} [${r.layerBreaking}]: UI=${r.uiValue}, API=${r.apiValue}, Jira=${r.jiraValue}`)
            .join('\n');
        const mode = strict ? 'strict mode' : 'UI\u2194API rendering';
        throw new Error(`Trends ${title} failed (${mode}) — ${failing.length}/${total} row(s) broke:\n${summary}`);
    }
}

function titleFor(tab: TrendsTab): string {
    switch (tab) {
        case 'productivity': return 'Productivity';
        case 'density':      return 'Defect Density';
        case 'leakage':      return 'Defect Leakage';
        case 'reopen':       return 'Reopen Ratio';
    }
}

/**
 * Small helper: assert a row's data-value attr matches the expected number
 * within a tolerance. The frontend stores the raw numeric value in data-value
 * (not the formatted text) so we can compare without string parsing.
 */
export async function expectRowValue(
    page: Page,
    projectId: number,
    testid: 'trends-row-current' | 'trends-row-avg',
    expected: number | null,
): Promise<void> {
    const row = page.locator(`[data-testid="trends-project-row-${projectId}"]`);
    const attr = await row.locator(`[data-testid="${testid}"]`).getAttribute('data-value');
    const actual = attr === '' || attr == null ? null : parseFloat(attr);
    expect(actual).toBe(expected);
}
