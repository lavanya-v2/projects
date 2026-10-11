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

test.describe('Trends — Reopen Ratio (UI ↔ API ↔ Jira)', () => {
    test.setTimeout(300_000);

    test('rendered values match API response and reconcile against live Jira for every project', async ({ page, request }) => {
        await loginAsSuperuser(page);
        await navigateToTrends(page, 'reopen');
        const { accountName, api } = await selectAccountWithData(page, 'reopen');
        const projects: any[] = api.projects ?? [];
        console.log(`\nTrends Reopen Ratio — reconciling ${projects.length} project(s) from account "${accountName}"`);

        // ── DOM ↔ API ─────────────────────────────────────────────────────────
        const greens = projects.filter(p => p.reopenRatio.health === 'green').length;
        const ambers = projects.filter(p => p.reopenRatio.health === 'amber').length;
        const reds = projects.filter(p => p.reopenRatio.health === 'red').length;
        await expect(page.locator('[data-testid="trends-summary-chip-green"]')).toContainText(`${greens} Healthy`);
        await expect(page.locator('[data-testid="trends-summary-chip-amber"]')).toContainText(`${ambers} Attention`);
        await expect(page.locator('[data-testid="trends-summary-chip-red"]')).toContainText(`${reds} At Risk`);

        for (const p of projects) {
            const row = page.locator(`[data-testid="trends-project-row-${p.projectId}"]`);
            await expect(row).toBeVisible();
            await expect(row.locator('[data-testid="trends-row-name"]')).toHaveText(p.projectName);
            await expect(row).toHaveAttribute('data-health', p.reopenRatio.health);
            await expectRowValue(page, p.projectId, 'trends-row-current', p.reopenRatio.current ?? null);
            await expectRowValue(page, p.projectId, 'trends-row-avg', p.reopenRatio.avg ?? null);
        }

        // ── Full-chain reconciliation ─────────────────────────────────────────
        const token = await readAuthToken(page);
        const rows: EvidenceRow[] = [];

        for (const p of projects) {
            const syncId = p.sprints?.[0]?.syncId;
            if (!syncId) continue;
            const sprintName = p.sprints[0].sprintName;

            const { quality } = await fetchReconciliation(request, syncId, token);
            const ui = `${p.reopenRatio.current ?? 0}%`;
            const apiVal = `${quality.reopenRatio.ours.reopenRatio}%`;
            const jiraVal = `${quality.reopenRatio.jira.reopenRatio}%`;

            const uiApiMatch = (p.reopenRatio.current ?? 0) === quality.reopenRatio.ours.reopenRatio;
            const apiJiraMatch = quality.reopenRatio.match;

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
                notes: !apiJiraMatch && quality.reopenRatio.reopenDiffKeys.length > 0
                    ? `per-ticket drift on: ${quality.reopenRatio.reopenDiffKeys.slice(0, 5).map((d: any) => `${d.jiraKey}(${d.ours}→${d.jira})`).join(', ')}${quality.reopenRatio.reopenDiffKeys.length > 5 ? '…' : ''}`
                    : undefined,
            });
        }

        assertEvidenceRows(rows, 'reopen');
    });
});
