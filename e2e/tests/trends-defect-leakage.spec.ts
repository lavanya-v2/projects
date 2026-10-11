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

test.describe('Trends — Defect Leakage (UI ↔ API ↔ Jira)', () => {
    test.setTimeout(300_000);

    test('rendered values match API response and reconcile against live Jira for every project', async ({ page, request }) => {
        await loginAsSuperuser(page);
        await navigateToTrends(page, 'leakage');
        const { accountName, api } = await selectAccountWithData(page, 'leakage');
        const projects: any[] = api.projects ?? [];
        console.log(`\nTrends Defect Leakage — reconciling ${projects.length} project(s) from account "${accountName}"`);

        // ── DOM ↔ API ─────────────────────────────────────────────────────────
        const greens = projects.filter(p => p.defectLeakage.health === 'green').length;
        const ambers = projects.filter(p => p.defectLeakage.health === 'amber').length;
        const reds = projects.filter(p => p.defectLeakage.health === 'red').length;
        await expect(page.locator('[data-testid="trends-summary-chip-green"]')).toContainText(`${greens} Healthy`);
        await expect(page.locator('[data-testid="trends-summary-chip-amber"]')).toContainText(`${ambers} Attention`);
        await expect(page.locator('[data-testid="trends-summary-chip-red"]')).toContainText(`${reds} At Risk`);

        for (const p of projects) {
            const row = page.locator(`[data-testid="trends-project-row-${p.projectId}"]`);
            await expect(row).toBeVisible();
            await expect(row.locator('[data-testid="trends-row-name"]')).toHaveText(p.projectName);
            await expect(row).toHaveAttribute('data-health', p.defectLeakage.health);
            await expectRowValue(page, p.projectId, 'trends-row-current', p.defectLeakage.current ?? null);
            await expectRowValue(page, p.projectId, 'trends-row-avg', p.defectLeakage.avg ?? null);
        }

        // ── Full-chain reconciliation ─────────────────────────────────────────
        const token = await readAuthToken(page);
        const rows: EvidenceRow[] = [];

        for (const p of projects) {
            const syncId = p.sprints?.[0]?.syncId;
            if (!syncId) continue;
            const sprintName = p.sprints[0].sprintName;

            const { quality } = await fetchReconciliation(request, syncId, token);
            const ui = String(p.defectLeakage.current ?? 0);
            const apiVal = String(quality.defectLeakage.oursProdBugCount);
            const jiraVal = `${quality.defectLeakage.freshProdBugCount} (snapshot=${quality.defectLeakage.snapshotProdBugKeyCount})`;

            const uiApiMatch = (p.defectLeakage.current ?? 0) === quality.defectLeakage.oursProdBugCount;
            const apiJiraMatch = quality.defectLeakage.match;

            const layerBreaking: EvidenceRow['layerBreaking'] =
                uiApiMatch && apiJiraMatch ? 'none'
                    : !uiApiMatch && !apiJiraMatch ? 'both'
                    : !uiApiMatch ? 'ui-vs-api'
                    : 'api-vs-jira';

            const leakageDrift = quality.defectLeakage;
            rows.push({
                projectName: p.projectName,
                sprintName,
                uiValue: ui,
                apiValue: apiVal,
                jiraValue: jiraVal,
                layerBreaking,
                notes: !apiJiraMatch
                    ? `missingFromFacts=${leakageDrift.missingFromFacts.join(',') || '∅'}; missingFromSnapshot=${leakageDrift.missingFromSnapshot.join(',') || '∅'}`
                    : undefined,
            });
        }

        assertEvidenceRows(rows, 'leakage');
    });
});
