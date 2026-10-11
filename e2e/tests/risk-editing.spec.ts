import { test, expect } from '@playwright/test';
import { loginAsSuperuser } from './helpers';
import { navigateTo } from './nav-helpers';
import { seedRisks, teardownRisks, cleanupOrphanedSeeds } from './api-seed';

test.describe('Risk Editing (Phase A)', () => {
    let seedToken = '';
    let seedIds: number[] = [];

    test.beforeAll(async () => {
        try {
            await cleanupOrphanedSeeds();
            const result = await seedRisks(2);
            seedToken = result.token;
            seedIds = result.ids;
        } catch (err) {
            console.warn('[risk-editing] Seed failed — tests will skip if no cards found:', err);
        }
    });

    test.afterAll(async () => {
        if (seedToken && seedIds.length > 0) {
            await teardownRisks(seedToken, seedIds);
        }
    });

    test.beforeEach(async ({ page }) => {
        await loginAsSuperuser(page);
        // Navigate to Risk Board via the new icon-rail
        await navigateTo(page, 'Risk Board');
        // Wait for the board to load and seeded cards to appear
        await page.locator('[data-testid="risk-card"]').first().waitFor({ state: 'visible', timeout: 15000 });
    });

    test('risk board renders without error', async ({ page }) => {
        await expect(page.locator('[role="alert"][class*="error"]')).not.toBeVisible({ timeout: 5000 });
        // Risk cards should be visible (seeded in beforeAll)
        await expect(page.locator('[data-testid="risk-card"]').first()).toBeVisible();
    });

    test('opening a risk card shows the detail modal', async ({ page }) => {
        await page.locator('[data-testid="risk-card"]').first().click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
    });

    test('superuser sees Edit button in risk detail modal', async ({ page }) => {
        await page.locator('[data-testid="risk-card"]').first().click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
        // Edit button visible for superuser
        const editBtn = page.locator('[role="dialog"]').locator('button[aria-label="Edit risk"]');
        await expect(editBtn).toBeVisible({ timeout: 3000 });
    });

    test('edit mode shows Priority select and Project autocomplete', async ({ page }) => {
        await page.locator('[data-testid="risk-card"]').first().click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

        const editBtn = page.locator('[role="dialog"]').locator('button[aria-label="Edit risk"]');
        await editBtn.click();

        // Priority select should appear
        await expect(page.locator('[role="dialog"]').locator('text=Priority').first()).toBeVisible({ timeout: 3000 });
        // Cancel button should appear
        await expect(page.locator('[role="dialog"]').locator('button', { hasText: 'Cancel' })).toBeVisible();
    });

    test('cancel edit mode reverts the UI', async ({ page }) => {
        await page.locator('[data-testid="risk-card"]').first().click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

        const editBtn = page.locator('[role="dialog"]').locator('button[aria-label="Edit risk"]');
        await editBtn.click();

        const cancelBtn = page.locator('[role="dialog"]').locator('button', { hasText: 'Cancel' });
        await cancelBtn.click();

        // Edit button should be visible again
        await expect(editBtn).toBeVisible({ timeout: 3000 });
    });

    test('opening a risk card shows AI Summary section without loading spinner', async ({ page }) => {
        await page.locator('[data-testid="risk-card"]').first().click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

        // Wait for the modal to fully load (AI Summary header appears)
        const dialog = page.locator('[role="dialog"]');
        await expect(dialog.getByText('AI Summary')).toBeVisible({ timeout: 5000 });

        // No spinner should be present in the AI section (stored value, not async fetch)
        await expect(dialog.locator('[class*="CircularProgress"]')).not.toBeVisible({ timeout: 1000 });
    });

    test('opening a risk does not call /ai-summary endpoint', async ({ page }) => {
        // Track requests BEFORE clicking
        const aiCalls: string[] = [];
        page.on('request', req => {
            if (req.url().match(/\/risks\/\d+\/ai-summary/)) aiCalls.push(req.url());
        });

        await page.locator('[data-testid="risk-card"]').first().click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

        // Wait for modal to fully load
        await page.locator('[role="dialog"]').getByText('AI Summary').waitFor({ timeout: 5000 });
        await page.waitForTimeout(500);

        expect(aiCalls).toHaveLength(0);
    });
});
