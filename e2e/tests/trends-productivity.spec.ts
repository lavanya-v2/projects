import { test, expect } from '@playwright/test';
import { loginAsSuperuser } from './helpers';
import {
    navigateToTrends,
    selectAccountWithData,
    readAuthToken,
    fetchReconciliation,
    assertEvidenceRows,
    expectRowValue,
    EvidenceRow,
} from './trends-helpers';

test.describe('Trends — Productivity (UI ↔ API ↔ Jira)', () => {
    test.setTimeout(300_000); // Live Jira reconciliation is slow (~10-30s per project).

    test('rendered values match API response and reconcile against live Jira for every project', async ({ page, request }) => {
        await loginAsSuperuser(page);
        await navigateToTrends(page, 'productivity');
        const { accountName, api } = await selectAccountWithData(page, 'productivity');
        const projects: any[] = api.projects ?? [];
        console.log(`\nTrends Productivity — reconciling ${projects.length} project(s) from account "${accountName}"`);

        // ── Assert DOM reflects the API response ──────────────────────────────

        // Summary chip counts
        const greens = projects.filter(p => p.health === 'green').length;
        const ambers = projects.filter(p => p.health === 'amber').length;
        const reds = projects.filter(p => p.health === 'red').length;
        await expect(page.locator('[data-testid="trends-summary-chip-green"]')).toContainText(`${greens} Healthy`);
        await expect(page.locator('[data-testid="trends-summary-chip-amber"]')).toContainText(`${ambers} Attention`);
        await expect(page.locator('[data-testid="trends-summary-chip-red"]')).toContainText(`${reds} At Risk`);

        // Each project row
        for (const p of projects) {
            const row = page.locator(`[data-testid="trends-project-row-${p.projectId}"]`);
            await expect(row).toBeVisible();
            await expect(row.locator('[data-testid="trends-row-name"]')).toHaveText(p.projectName);
            await expect(row).toHaveAttribute('data-health', p.health);
            await expectRowValue(page, p.projectId, 'trends-row-current', p.currentProductivity ?? null);
            await expectRowValue(page, p.projectId, 'trends-row-avg', p.avgProductivity ?? null);
            await expect(row.locator('[data-testid="trends-row-trend"]'))
                .toHaveAttribute('data-trend', p.trend);
            await expect(row.locator('[data-testid="trends-row-trend"]'))
                .toHaveAttribute('data-trend-pct', String(p.trendPct));
        }

        // ── Full-chain reconciliation via the backend endpoint ────────────────

        const token = await readAuthToken(page);
        const rows: EvidenceRow[] = [];

        for (const p of projects) {
            const syncId = p.sprints?.[0]?.syncId;
            if (!syncId) continue;
            const sprintName = p.sprints[0].sprintName;

            const { productivity } = await fetchReconciliation(request, syncId, token);
            const ui = `${p.currentProductivity ?? 0}%`;
            const apiVal = `${productivity.computed.ourProductivity}%`;
            const jiraVal = `${productivity.computed.jiraProductivity}%`;

            const uiApiMatch = (p.currentProductivity ?? 0) === productivity.computed.ourProductivity;
            const apiJiraMatch = productivity.computed.match;

            const layerBreaking: EvidenceRow['layerBreaking'] =
                uiApiMatch && apiJiraMatch ? 'none'
                    : !uiApiMatch && !apiJiraMatch ? 'both'
                    : !uiApiMatch ? 'ui-vs-api'
                    : 'api-vs-jira';

            rows.push({
                projectName: p.projectName,
                sprintName,
                uiValue: ui,
                apiValue: apiVal,
                jiraValue: jiraVal,
                layerBreaking,
            });
        }

        assertEvidenceRows(rows, 'productivity');
    });
});
