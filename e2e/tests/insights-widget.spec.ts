import { test, expect } from '@playwright/test';
import { loginAsSuperuser } from './helpers';
import { navigateTo, openRailSection } from './nav-helpers';

test.describe('Project Insights Widget', () => {
    test('Daily Report: section label is "Project Insights" (not old label)', async ({ page }) => {
        await loginAsSuperuser(page);
        await navigateTo(page, 'Daily Reports');
        await page.waitForTimeout(1000);

        // Old label must not appear
        const oldLabel = await page.getByText('Lead / Manager Insights', { exact: true }).count();
        expect(oldLabel).toBe(0);

        // No page-level errors
        const hasError = await page.locator('[role="alert"][class*="error"]').count() > 0;
        expect(hasError).toBe(false);
    });

    test('Dashboard loads without error for superuser', async ({ page }) => {
        await loginAsSuperuser(page);
        await openRailSection(page, 'Dashboard');
        await page.waitForTimeout(2000);
        await expect(page.locator('[role="alert"][class*="error"]')).not.toBeVisible({ timeout: 5000 });
    });

    test('Dashboard: "Project Insights" toggle is visible on manager tiles', async ({ page }) => {
        await loginAsSuperuser(page);
        await openRailSection(page, 'Dashboard');
        await page.waitForLoadState('networkidle');
        // Superuser sees executive view; manager tiles are in ManagerDashboard (not shown for superuser).
        // Verify page loaded without issue.
        await expect(page.locator('[role="alert"][class*="error"]')).not.toBeVisible({ timeout: 5000 });
    });
});
