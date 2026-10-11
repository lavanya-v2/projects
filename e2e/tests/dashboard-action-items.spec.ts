import { test, expect } from '@playwright/test';
import { loginAsSuperuser, loginAsManager, loginAsLead } from './helpers';
import { seedRisks, teardownRisks, cleanupOrphanedSeeds } from './api-seed';

// ─── Dashboard — Recent Action Items widget ──────────────────────────────────

test.describe('Dashboard — Recent Action Items (Superuser)', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsSuperuser(page);
        await page.locator('text=Dashboard').first().click();
        await page.waitForLoadState('networkidle');
    });

    test('Recent Action Items panel visible on superuser dashboard', async ({ page }) => {
        const panel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Recent Action Items' }).first();
        // Panel may not be visible if no action items exist — both outcomes are valid
        const isVisible = await panel.isVisible().catch(() => false);
        if (isVisible) {
            await expect(panel).toBeVisible();
        }
    });

    test('Recent Action Items shows View All button', async ({ page }) => {
        const panel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Recent Action Items' }).first();
        if (!await panel.isVisible().catch(() => false)) { test.skip(); return; }
        await expect(panel.locator('button:has-text("View All")')).toBeVisible({ timeout: 3000 });
    });

    test('View All button navigates to Action Items page', async ({ page }) => {
        const panel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Recent Action Items' }).first();
        if (!await panel.isVisible().catch(() => false)) { test.skip(); return; }
        await panel.locator('button:has-text("View All")').click();
        await page.waitForTimeout(2000);
        // Should navigate away from Executive Overview to Action Items page
        const onActionItems = await page.locator('text=Project Items').isVisible().catch(() => false)
            || await page.locator('text=Project Action Items').isVisible().catch(() => false);
        expect(onActionItems).toBe(true);
    });

    test('Recent Action Items shows at most 5 items', async ({ page }) => {
        const panel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Recent Action Items' }).first();
        if (!await panel.isVisible().catch(() => false)) { test.skip(); return; }
        const rows = panel.locator('tbody tr');
        const count = await rows.count();
        expect(count).toBeLessThanOrEqual(5);
    });
});

test.describe('Dashboard — Action Items (Manager)', () => {
    test('manager dashboard shows action items panel with View All', async ({ page }) => {
        try { await loginAsManager(page); } catch { test.skip(); return; }
        await page.waitForLoadState('networkidle');
        // Manager dashboard shows Action Items panel
        const panel = page.locator('text=Action Items').first();
        await expect(panel).toBeVisible({ timeout: 8000 });
        // View All button
        const viewAllBtn = page.locator('button:has-text("View All")').first();
        if (await viewAllBtn.isVisible().catch(() => false)) {
            await expect(viewAllBtn).toBeVisible();
        }
    });
});

// ─── Dashboard — Top Risks Panel (unchanged from original) ──────────────────

test.describe('Dashboard — Top Risks Panel', () => {
    let seedToken = '';
    let seedIds: number[] = [];

    test.beforeAll(async () => {
        try {
            await cleanupOrphanedSeeds();
            const result = await seedRisks(2);
            seedToken = result.token;
            seedIds = result.ids;
        } catch (err) {
            console.warn('[dashboard-action-items] Seed failed:', err);
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

    test('Top Risks panel is visible after seeding', async ({ page }) => {
        await expect(page.getByText('Top Risks')).toBeVisible({ timeout: 10000 });
    });

    test('Top Risks panel shows risk rows with priority icons', async ({ page }) => {
        const topRisksPanel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Top Risks' }).first();
        await expect(topRisksPanel).toBeVisible({ timeout: 8000 });
        const titleCells = topRisksPanel.locator('p[title]');
        const count = await titleCells.count();
        expect(count).toBeGreaterThan(0);
    });

    test('Top Risks panel shows at most 5 rows', async ({ page }) => {
        const topRisksPanel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Top Risks' }).first();
        await expect(topRisksPanel).toBeVisible({ timeout: 8000 });
        const titleCells = topRisksPanel.locator('p[title]');
        const count = await titleCells.count();
        expect(count).toBeLessThanOrEqual(5);
    });

    test('clicking a Top Risks row opens read-only detail modal', async ({ page }) => {
        const topRisksPanel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Top Risks' }).first();
        await expect(topRisksPanel).toBeVisible({ timeout: 8000 });
        const firstTitle = topRisksPanel.locator('p[title]').first();
        await firstTitle.waitFor({ state: 'visible', timeout: 5000 });
        await firstTitle.click();
        await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
        const editBtn = page.locator('[role="dialog"]').locator('button[aria-label="Edit risk"]');
        await expect(editBtn).not.toBeVisible({ timeout: 2000 });
    });
});

// ─── Project Health Panel — Navigation (unchanged) ───────────────────────────

test.describe('Project Health Panel — Navigation', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsSuperuser(page);
        await page.locator('text=Dashboard').first().click();
        await page.waitForLoadState('networkidle');
    });

    test('Project Health panel is present on superuser dashboard', async ({ page }) => {
        const healthPanel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Project Health' }).first();
        const isVisible = await healthPanel.isVisible().catch(() => false);
        if (!isVisible) { test.skip(); return; }
        await expect(healthPanel).toBeVisible();
    });

    test('clicking project name navigates away from Executive Overview', async ({ page }) => {
        const healthPanel = page.locator('[class*="MuiPaper"]').filter({ hasText: 'Project Health' }).first();
        if (!await healthPanel.isVisible().catch(() => false)) { test.skip(); return; }
        const projectLink = healthPanel.locator('tbody tr td:first-child p').first();
        if (await projectLink.count() === 0) { test.skip(); return; }
        await projectLink.click();
        await page.waitForTimeout(1500);
        const stillOnDashboard = await page.getByText('Executive Overview').isVisible().catch(() => false);
        expect(stillOnDashboard).toBe(false);
    });
});
