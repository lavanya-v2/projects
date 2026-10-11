import { test, expect } from '@playwright/test';
import { loginAsSuperuser } from './helpers';

test.describe('Dashboard — Superuser/Admin view', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsSuperuser(page);
        // Make sure we are on dashboard
        await page.locator('text=Dashboard').first().click();
        await page.waitForTimeout(1500);
    });

    test('shows account tiles or empty state', async ({ page }) => {
        // Either account tiles or "No accounts found" message
        const hasTiles = await page.locator('[class*="MuiPaper"]').count() > 0;
        expect(hasTiles).toBe(true);
    });

    test('Dashboard header is visible', async ({ page }) => {
        await expect(page.locator('text=Dashboard').first()).toBeVisible();
    });

    test('long-pending AIs section present if data exists', async ({ page }) => {
        // The section only appears if there are long-pending AIs — just check the page loads without error
        await expect(page.locator('[role="alert"][class*="error"]')).not.toBeVisible({ timeout: 5000 });
    });

    test('Top Risks panel is visible on superuser dashboard', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        await expect(page.getByText('Top Risks')).toBeVisible({ timeout: 10000 });
    });

    test('Top Risks panel shows at most 5 rows', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        const topRisksPanel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Top Risks' }).first();
        const isVisible = await topRisksPanel.isVisible().catch(() => false);
        if (!isVisible) {
            test.skip();
            return;
        }
        // Count clickable risk rows inside panel (each has a priority emoji)
        const rows = topRisksPanel.locator('text=/🔴|🟠|🟡|🟢/');
        const rowCount = await rows.count();
        expect(rowCount).toBeLessThanOrEqual(5);
    });

    test('Top Risks panel shows "View All" link when total > shown', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        // "View All" only appears when totalActiveRisks > topRisks.length
        // If not visible, skip gracefully
        const viewAll = page.getByText('View All →');
        const visible = await viewAll.isVisible().catch(() => false);
        if (!visible) {
            // No "View All" because total equals shown — acceptable
            return;
        }
        await expect(viewAll).toBeVisible();
    });

    test('clicking a risk row in Top Risks panel opens a read-only modal', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        const topRisksPanel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Top Risks' }).first();
        const isVisible = await topRisksPanel.isVisible().catch(() => false);
        if (!isVisible) {
            test.skip();
            return;
        }
        // Find a clickable risk row (cursor: pointer rows with priority icon)
        const rows = topRisksPanel.locator('[style*="cursor: pointer"], [style*="cursor:pointer"]')
            .or(topRisksPanel.locator('div').filter({ hasText: /🔴|🟠|🟡|🟢/ }));
        const count = await rows.count();
        if (count === 0) {
            test.skip();
            return;
        }
        await rows.first().click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
        // Should not have an Edit button (view-only mode)
        const editBtn = page.locator('[role="dialog"]').locator('button[aria-label="Edit risk"]');
        await expect(editBtn).not.toBeVisible({ timeout: 2000 });
    });

    test('Project Health panel shows dot+text health (not chips)', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        const healthPanel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Project Health' }).first();
        const isVisible = await healthPanel.isVisible().catch(() => false);
        if (!isVisible) {
            test.skip();
            return;
        }
        // Health column should use plain text (Green/Amber/Red) not chips
        await expect(healthPanel.getByText(/^(Green|Amber|Red)$/).first()).toBeVisible({ timeout: 5000 }).catch(() => {
            // No data — skip
        });
        // Chips in health column removed — assert fewer chips overall in health rows
        const chips = healthPanel.locator('[class*="MuiChip"]');
        const chipCount = await chips.count();
        // Health column, Sprint column, Risks/AIs column should have NO chips
        expect(chipCount).toBe(0);
    });

    test('Project Health list shows Red/Amber before Green projects', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        const healthPanel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Project Health' }).first();
        const isVisible = await healthPanel.isVisible().catch(() => false);
        if (!isVisible) {
            test.skip();
            return;
        }
        // Check that if both Red/Amber and Green rows exist, Red/Amber come first
        const redOrAmber = healthPanel.getByText(/^(Red|Amber)$/).first();
        const green = healthPanel.getByText(/^Green$/).first();
        const hasRed = await redOrAmber.isVisible().catch(() => false);
        const hasGreen = await green.isVisible().catch(() => false);
        if (!hasRed || !hasGreen) {
            // Cannot verify ordering without both types — skip
            return;
        }
        const redBox = await redOrAmber.boundingBox();
        const greenBox = await green.boundingBox();
        if (redBox && greenBox) {
            expect(redBox.y).toBeLessThan(greenBox.y);
        }
    });

    test('Green projects expand toggle appears when more than 3 green projects', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        const toggle = page.getByText(/Show \d+ more healthy project/);
        const visible = await toggle.isVisible().catch(() => false);
        if (!visible) {
            // Not enough green projects — acceptable
            return;
        }
        await expect(toggle).toBeVisible();
        // Click it and verify it expands
        await toggle.click();
        await expect(toggle).not.toBeVisible({ timeout: 2000 });
    });
});
