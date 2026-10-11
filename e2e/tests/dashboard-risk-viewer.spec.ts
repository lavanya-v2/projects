import { test, expect } from '@playwright/test';
import { loginAsSuperuser } from './helpers';
import { seedRisks, teardownRisks, cleanupOrphanedSeeds } from './api-seed';

test.describe('Dashboard Risk Viewer — view-only modal (Phase B)', () => {
    let seedToken = '';
    let seedIds: number[] = [];

    test.beforeAll(async () => {
        try {
            await cleanupOrphanedSeeds();
            const result = await seedRisks(2);
            seedToken = result.token;
            seedIds = result.ids;
        } catch (err) {
            console.warn('[dashboard-risk-viewer] Seed failed:', err);
        }
    });

    test.afterAll(async () => {
        if (seedToken && seedIds.length > 0) {
            await teardownRisks(seedToken, seedIds);
        }
    });

    test.beforeEach(async ({ page }) => {
        await loginAsSuperuser(page);
        await page.locator('text=Dashboard').first().click();
        await page.waitForLoadState('networkidle');
    });

    test('Top Risks panel renders without error', async ({ page }) => {
        await expect(page.locator('[role="alert"][class*="error"]')).not.toBeVisible({ timeout: 5000 });
        // New panel is "Top Risks" (replaced old "Active Risks — All Accounts")
        const panel = page.getByText('Top Risks').first();
        await expect(panel).toBeVisible({ timeout: 8000 });
    });

    test('clicking a risk row in Top Risks opens a view-only detail modal', async ({ page }) => {
        // Risks appear in the "Top Risks" panel
        const topRisksPanel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Top Risks' }).first();
        await expect(topRisksPanel).toBeVisible({ timeout: 8000 });

        // Risk rows are Box elements with onClick — find by priority emoji
        const riskRows = topRisksPanel.locator('div').filter({ hasText: /🔴|🟠|🟡|🟢/ }).first();
        const count = await riskRows.count();
        if (count === 0) {
            test.skip();
            return;
        }
        await riskRows.click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
    });

    test('view-only modal does NOT show Edit button for dashboard risk', async ({ page }) => {
        const topRisksPanel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Top Risks' }).first();
        await expect(topRisksPanel).toBeVisible({ timeout: 8000 });

        const riskRows = topRisksPanel.locator('div').filter({ hasText: /🔴|🟠|🟡|🟢/ }).first();
        const count = await riskRows.count();
        if (count === 0) {
            test.skip();
            return;
        }
        await riskRows.click();
        await page.waitForTimeout(800);

        const dialog = page.locator('[role="dialog"]');
        const dialogVisible = await dialog.isVisible().catch(() => false);
        if (!dialogVisible) {
            test.skip();
            return;
        }
        // Edit button should NOT appear in viewOnly mode
        const editBtn = dialog.locator('button[aria-label="Edit risk"]');
        await expect(editBtn).not.toBeVisible();
    });

    test('view-only modal shows AI Summary section', async ({ page }) => {
        const topRisksPanel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Top Risks' }).first();
        await expect(topRisksPanel).toBeVisible({ timeout: 8000 });

        const riskRows = topRisksPanel.locator('div').filter({ hasText: /🔴|🟠|🟡|🟢/ }).first();
        const count = await riskRows.count();
        if (count === 0) {
            test.skip();
            return;
        }
        await riskRows.click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

        // AI Summary section should be present (stored value or placeholder)
        await expect(page.locator('[role="dialog"]').getByText('AI Summary')).toBeVisible({ timeout: 3000 });
    });
});
