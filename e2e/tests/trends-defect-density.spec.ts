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

test.describe('Trends — Defect Density (UI ↔ API ↔ Jira)', () => {
    test.setTimeout(300_000);

    test('rendered values match API response and reconcile against live Jira for every project', async ({ page, request }) => {
        await loginAsSuperuser(page);
        await navigateToTrends(page, 'density');
        const { accountName, api } = await selectAccountWithData(page, 'density');
        const projects: any[] = api.projects ?? [];
        console.log(`\nTrends Defect Density — reconciling ${projects.length} project(s) from account "${accountName}"`);

        // ── Assert DOM reflects the API response ──────────────────────────────
        const greens = projects.filter(p => p.defectDensity.health === 'green').length;
        const ambers = projects.filter(p => p.defectDensity.health === 'amber').length;
        const reds = projects.filter(p => p.defectDensity.health === 'red').length;
        await expect(page.locator('[data-testid="trends-summary-chip-green"]')).toContainText(`${greens} Healthy`);
        await expect(page.locator('[data-testid="trends-summary-chip-amber"]')).toContainText(`${ambers} Attention`);
        await expect(page.locator('[data-testid="trends-summary-chip-red"]')).toContainText(`${reds} At Risk`);

        for (const p of projects) {
            const row = page.locator(`[data-testid="trends-project-row-${p.projectId}"]`);
            await expect(row).toBeVisible();
            await expect(row.locator('[data-testid="trends-row-name"]')).toHaveText(p.projectName);
            await expect(row).toHaveAttribute('data-health', p.defectDensity.health);
            await expectRowValue(page, p.projectId, 'trends-row-current', p.defectDensity.current ?? null);
            await expectRowValue(page, p.projectId, 'trends-row-avg', p.defectDensity.avg ?? null);
        }

        // ── Full-chain reconciliation ─────────────────────────────────────────
        const token = await readAuthToken(page);
        const rows: EvidenceRow[] = [];

        for (const p of projects) {
            const syncId = p.sprints?.[0]?.syncId;
            if (!syncId) continue;
            const sprintName = p.sprints[0].sprintName;

            const { quality } = await fetchReconciliation(request, syncId, token);
            const ui = String(p.defectDensity.current ?? 0);
            const apiVal = String(quality.defectDensity.ours.density);
            const jiraVal = String(quality.defectDensity.jira.density);

            const uiApiMatch = (p.defectDensity.current ?? 0) === quality.defectDensity.ours.density;
            const apiJiraMatch = quality.defectDensity.match;

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
                notes: uiApiMatch && !apiJiraMatch
                    ? `bugCount ours=${quality.defectDensity.ours.bugCount} / jira=${quality.defectDensity.jira.bugCount}; totalSp ours=${quality.defectDensity.ours.totalSp} / jira=${quality.defectDensity.jira.totalSp}`
                    : undefined,
            });
        }

        assertEvidenceRows(rows, 'density');
    });
});
