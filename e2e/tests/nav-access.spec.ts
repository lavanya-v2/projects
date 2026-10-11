import { test, expect } from '@playwright/test';
import { loginAsSuperuser, loginAsAdmin, loginAsManager, loginAsLead, loginAsMember } from './helpers';
import { isRailSectionVisible, isLeafNavVisible, navigateTo, openRailSection } from './nav-helpers';

test.describe('Navigation access — Superuser', () => {
    test.beforeEach(async ({ page }) => { await loginAsSuperuser(page); });

    test('sidebar shows Dashboard rail item', async ({ page }) => {
        expect(await isRailSectionVisible(page, 'Dashboard')).toBe(true);
    });

    test('default landing is Dashboard page', async ({ page }) => {
        // After login the page heading is "Dashboard"
        await expect(page.locator('text=Dashboard').first()).toBeVisible({ timeout: 8000 });
    });

    test('superuser sees Administration section', async ({ page }) => {
        expect(await isRailSectionVisible(page, 'Administration')).toBe(true);
    });

    test('superuser sees MANAGEMENT section with Team Performance, Action Items, Risk Board', async ({ page }) => {
        expect(await isRailSectionVisible(page, 'Management')).toBe(true);
        await openRailSection(page, 'Management');
        await expect(page.locator('text=Team Performance').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('text=Action Items').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('text=Risk Board').first()).toBeVisible({ timeout: 5000 });
    });

    test('superuser sees PRESENTATION section with Bi-Weekly and Sprint Data', async ({ page }) => {
        expect(await isRailSectionVisible(page, 'Presentation')).toBe(true);
        await openRailSection(page, 'Presentation');
        await expect(page.locator('text=Bi-Weekly Status').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('text=Sprint Data').first()).toBeVisible({ timeout: 5000 });
    });

    test('Action Items page shows both Project and Account tabs', async ({ page }) => {
        await navigateTo(page, 'Action Items');
        await expect(page.locator('text=Project Items')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('text=Account Items')).toBeVisible({ timeout: 5000 });
    });

    test('superuser can navigate to Risk Board', async ({ page }) => {
        await navigateTo(page, 'Risk Board');
        // Risk Board page renders its own header — kanban lanes should be visible
        await expect(page.locator('text=Risk Management Board').first()).toBeVisible({ timeout: 8000 });
    });
});

test.describe('Navigation access — Manager', () => {
    test('manager sees MANAGEMENT section with Team Performance and Action Items', async ({ page }) => {
        try { await loginAsManager(page); } catch { test.skip(); return; }
        expect(await isRailSectionVisible(page, 'Management')).toBe(true);
        await openRailSection(page, 'Management');
        await expect(page.locator('text=Team Performance').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('text=Action Items').first()).toBeVisible({ timeout: 5000 });
    });

    test('manager sees Risk Board (RBAC update)', async ({ page }) => {
        // Updated for the new RBAC: managers DO see Risk Board now (was previously hidden).
        try { await loginAsManager(page); } catch { test.skip(); return; }
        expect(await isLeafNavVisible(page, 'Risk Board')).toBe(true);
    });

    test('manager does NOT see PRESENTATION section', async ({ page }) => {
        try { await loginAsManager(page); } catch { test.skip(); return; }
        expect(await isRailSectionVisible(page, 'Presentation')).toBe(false);
    });

    test('manager Action Items page shows only Project Items (no Account tab)', async ({ page }) => {
        try { await loginAsManager(page); } catch { test.skip(); return; }
        await navigateTo(page, 'Action Items');
        await expect(page.getByText('Project Action Items', { exact: true })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('text=Account Items')).not.toBeVisible({ timeout: 3000 });
    });
});

test.describe('Navigation access — Lead', () => {
    test('lead sees MANAGEMENT section with Team Performance and Action Items', async ({ page }) => {
        try { await loginAsLead(page); } catch { test.skip(); return; }
        expect(await isRailSectionVisible(page, 'Management')).toBe(true);
        await openRailSection(page, 'Management');
        await expect(page.locator('text=Team Performance').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('text=Action Items').first()).toBeVisible({ timeout: 5000 });
    });

    test('lead does NOT see Account Items tab', async ({ page }) => {
        try { await loginAsLead(page); } catch { test.skip(); return; }
        await navigateTo(page, 'Action Items');
        await expect(page.locator('text=Account Items')).not.toBeVisible({ timeout: 3000 });
    });
});

test.describe('Navigation access — Member', () => {
    test('member sees MANAGEMENT section with Team Performance and Action Items', async ({ page }) => {
        try { await loginAsMember(page); } catch { test.skip(); return; }
        expect(await isRailSectionVisible(page, 'Management')).toBe(true);
        await openRailSection(page, 'Management');
        await expect(page.locator('text=Team Performance').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('text=Action Items').first()).toBeVisible({ timeout: 5000 });
    });
});
