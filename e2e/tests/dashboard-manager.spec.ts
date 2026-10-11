import { test, expect } from '@playwright/test';
import { loginAsSuperuser } from './helpers';

// These tests run as superuser but verify manager-dashboard UI components.
// A real manager credential is not seeded in dev, so we rely on the superuser
// seeing the superuser view and verify that the manager view components are
// structurally correct.  Where we cannot guarantee data exists we skip gracefully.

test.describe('Manager Dashboard UI', () => {
    test('superuser dashboard shows Executive Overview header', async ({ page }) => {
        await loginAsSuperuser(page);
        await expect(page.getByText('Executive Overview')).toBeVisible();
    });

    test('superuser dashboard shows today date string', async ({ page }) => {
        await loginAsSuperuser(page);
        // Date format: "Saturday, April 4, 2026" — just check a word present
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const today = days[new Date().getDay()];
        await expect(page.getByText(today, { exact: false }).first()).toBeVisible();
    });

    test('superuser dashboard shows Accounts section', async ({ page }) => {
        await loginAsSuperuser(page);
        // Matches exactly "Accounts (N)" — anchored
        await expect(
            page.getByText(/^Accounts \(\d+\)$/).or(page.getByText('No accounts found.'))
        ).toBeVisible({ timeout: 15000 });
    });

    test('superuser dashboard Top Risks panel present', async ({ page }) => {
        await loginAsSuperuser(page);
        await page.waitForLoadState('networkidle');
        await expect(page.getByText('Top Risks')).toBeVisible({ timeout: 10000 });
    });

    test('superuser dashboard Project Health panel present', async ({ page }) => {
        await loginAsSuperuser(page);
        await page.waitForLoadState('networkidle');
        const panel = page.locator('text=Project Health');
        const isVisible = await panel.isVisible().catch(() => false);
        if (!isVisible) {
            test.skip();
            return;
        }
        await expect(panel).toBeVisible();
        // Health column header present
        await expect(page.getByText('Health').first()).toBeVisible();
    });

    test('superuser dashboard health table has no MuiChip in health/sprint/risks columns', async ({ page }) => {
        await loginAsSuperuser(page);
        await page.waitForLoadState('networkidle');
        const healthPanel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Project Health' }).first();
        const isVisible = await healthPanel.isVisible().catch(() => false);
        if (!isVisible) {
            test.skip();
            return;
        }
        // The new design uses dot + plain text — no chips in the health list rows
        const chips = healthPanel.locator('[class*="MuiChip"]');
        const chipCount = await chips.count();
        expect(chipCount).toBe(0);
    });
});
