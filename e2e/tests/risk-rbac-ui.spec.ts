/**
 * Risk RBAC — UI smoke tests.
 *
 * Verifies the rendered UI matches the server-provided permission flags:
 *   - Risk Board nav visibility per role (suite J1-J5)
 *   - Edit / Mark-as-Done button gating in detail modal (suite J6-J9)
 *
 * The fixtures (risks + extra users) are created via the same helpers as the
 * API spec; this file logs into the real frontend at http://localhost:5173.
 */

import { test, expect, Page } from '@playwright/test';
import { setupRbacFixtures, teardownRbacFixtures, type RbacFixtures } from './risk-rbac-helpers';
import { navigateTo, isLeafNavVisible } from './nav-helpers';

test.describe.configure({ mode: 'serial', retries: 0 });

const CREDS = {
    superuser: { userId: 'superuser', password: 'V2CCMH@superUser' },
    admin: { userId: 'admin@v2solutions.com', password: 'password123' },
    manager1: { userId: 'manager@v2solutions.com', password: 'password123' },
    lead1: { userId: 'lead@v2solutions.com', password: 'password123' },
    member: { userId: 'member@v2solutions.com', password: 'password123' },
};

async function login(page: Page, role: keyof typeof CREDS): Promise<void> {
    const creds = CREDS[role];
    await page.goto('/');
    await page.waitForSelector('text=Welcome back', { timeout: 10000 });
    await page.locator('input[type="text"]').first().fill(creds.userId);
    await page.locator('input[type="password"]').first().fill(creds.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    // Login heading goes away on success
    await page.waitForSelector('text=Welcome back', { state: 'hidden', timeout: 15000 });
    await page.waitForLoadState('networkidle');
}

async function openRiskByTitleSubstring(page: Page, titleSubstring: string): Promise<void> {
    // Open the Risk Board via the icon-rail Management section
    await navigateTo(page, 'Risk Board');
    // Wait for any cards
    await page.locator('[data-testid="risk-card"]').first().waitFor({ state: 'visible', timeout: 15000 });
    // Find the card whose visible text contains our unique substring.
    // Risk titles are truncated/wrapped on the card but the substring still matches.
    const card = page.locator('[data-testid="risk-card"]').filter({ hasText: titleSubstring }).first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
}

// Use a distinct title prefix from the API spec so the two suites can run
// in parallel workers without their dbHardCleanup deleting each other's risks.
const UI_TITLE_PREFIX = '[E2E-RBAC-UI]';

test.describe('Risk RBAC — UI smoke', () => {
    let fx: RbacFixtures;

    test.beforeAll(async () => {
        fx = await setupRbacFixtures(UI_TITLE_PREFIX);
    });

    test.afterAll(async () => {
        if (fx) await teardownRbacFixtures(fx);
    });

    // ----------------------------------------------------------------------
    // J1-J5: Nav visibility per role
    // ----------------------------------------------------------------------

    test('J1 superuser sees Risk Board in nav', async ({ page }) => {
        await login(page, 'superuser');
        expect(await isLeafNavVisible(page, 'Risk Board')).toBe(true);
    });

    test('J2 admin sees Risk Board in nav', async ({ page }) => {
        await login(page, 'admin');
        expect(await isLeafNavVisible(page, 'Risk Board')).toBe(true);
    });

    test('J3 manager sees Risk Board in nav', async ({ page }) => {
        await login(page, 'manager1');
        expect(await isLeafNavVisible(page, 'Risk Board')).toBe(true);
    });

    test('J4 lead sees Risk Board in nav', async ({ page }) => {
        await login(page, 'lead1');
        expect(await isLeafNavVisible(page, 'Risk Board')).toBe(true);
    });

    test('J5 member does NOT see Risk Board in nav', async ({ page }) => {
        await login(page, 'member');
        expect(await isLeafNavVisible(page, 'Risk Board')).toBe(false);
    });

    // ----------------------------------------------------------------------
    // J6-J9: Detail modal button gating
    // ----------------------------------------------------------------------

    test('J6 lead opens own risk — Mark as Done button NOT rendered', async ({ page }) => {
        await login(page, 'lead1');
        await openRiskByTitleSubstring(page, `${UI_TITLE_PREFIX} By lead1`);
        const dialog = page.locator('[role="dialog"]');
        // The "Mark as Done" button is hidden when canMarkDone=false.
        // The button is wrapped in a Tooltip so getByRole(name=...) does not match —
        // use a text locator inside the dialog actions instead.
        await expect(dialog.locator('button:has-text("Mark as Done")')).toHaveCount(0);
    });

    test('J7 lead opens manager-created risk — Edit button NOT rendered, Comment input rendered', async ({ page }) => {
        await login(page, 'lead1');
        await openRiskByTitleSubstring(page, `${UI_TITLE_PREFIX} By manager1`);
        const dialog = page.locator('[role="dialog"]');
        // Edit (pencil) button hidden because canEdit=false
        await expect(dialog.locator('button[aria-label="Edit risk"]')).toHaveCount(0);
        // Comment input still present (canComment=true for visible risks)
        await expect(dialog.locator('textarea').first()).toBeVisible();
    });

    test('J8 manager opens lead-created risk — Mark as Done button rendered', async ({ page }) => {
        await login(page, 'manager1');
        await openRiskByTitleSubstring(page, `${UI_TITLE_PREFIX} By lead1`);
        const dialog = page.locator('[role="dialog"]');
        await expect(dialog.locator('button:has-text("Mark as Done")')).toBeVisible({ timeout: 5000 });
    });

    test('J9 manager opens other-manager risk — Edit button NOT rendered (same rank, other creator)', async ({ page }) => {
        await login(page, 'manager1');
        await openRiskByTitleSubstring(page, `${UI_TITLE_PREFIX} By manager2`);
        const dialog = page.locator('[role="dialog"]');
        await expect(dialog.locator('button[aria-label="Edit risk"]')).toHaveCount(0);
    });
});
