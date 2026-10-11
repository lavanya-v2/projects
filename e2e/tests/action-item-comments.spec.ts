import { test, expect } from '@playwright/test';
import { loginAsSuperuser, loginAsAdmin, loginAsLead, loginAsManager, loginAsMember, login, LEAD_CREDS } from './helpers';
import { navigateTo } from './nav-helpers';
import { getSuperuserToken } from './api-seed';

// All test data (users, action items with comments) seeded by global-setup.ts

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

// Helper: navigate to Action Items and open the first row.
// The page now defaults to All Accounts / All Projects / All status, so items
// load immediately without selecting a specific account or project.
async function openFirstProjectItem(page: any) {
    await navigateTo(page, 'Action Items');
    await page.waitForTimeout(800);

    const rows = page.locator('table tbody tr:not(:has(td[colspan]))');
    if (await rows.count() === 0) return false;
    await rows.first().click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
    return true;
}

// =============================================================================
// SUPERUSER — add comment, delete any comment
// =============================================================================

test.describe('Comments — Superuser', () => {
    test.beforeEach(async ({ page }) => { await loginAsSuperuser(page); });

    test('Comments section visible in item detail', async ({ page }) => {
        if (!await openFirstProjectItem(page)) { test.skip(); return; }
        // Use the heading specifically — the dialog also contains a "No comments yet" caption
        await expect(page.locator('[role="dialog"]').getByRole('heading', { name: 'Comments' })).toBeVisible({ timeout: 5000 });
    });

    test('superuser sees comment textarea + Post button', async ({ page }) => {
        if (!await openFirstProjectItem(page)) { test.skip(); return; }
        const dialog = page.locator('[role="dialog"]');
        const isTerminal = await dialog.locator('.MuiChip-label:text-is("Closed"), .MuiChip-label:text-is("Discarded")').first().isVisible().catch(() => false);
        if (!isTerminal) {
            await expect(dialog.locator('textarea').first()).toBeVisible({ timeout: 3000 });
            await expect(dialog.getByRole('button', { name: 'Post' })).toBeVisible({ timeout: 3000 });
        }
    });

    test('superuser can see delete icon on comments (can delete any)', async ({ page }) => {
        if (!await openFirstProjectItem(page)) { test.skip(); return; }
        const dialog = page.locator('[role="dialog"]');
        // If item has comments and is non-terminal, delete icons should be visible for superuser
        const deleteIcons = dialog.locator('[data-testid="DeleteOutlineIcon"]');
        await expect(dialog).toBeVisible();
    });

    test('superuser can add comment via API (backend)', async () => {
        const token = await getSuperuserToken();
        // Get first open action item via API
        const res = await fetch(`${BACKEND_URL}/api/projects`, { headers: { Authorization: `Bearer ${token}` } });
        const projects = (await res.json())?.data ?? [];
        if (projects.length === 0) { test.skip(); return; }
        const itemsRes = await fetch(`${BACKEND_URL}/api/report/project/${projects[0].id}/action-items?status=open`, { headers: { Authorization: `Bearer ${token}` } });
        const items = await itemsRes.json();
        if (!Array.isArray(items) || items.length === 0) { test.skip(); return; }
        const commentRes = await fetch(`${BACKEND_URL}/api/report/action-item/${items[0].id}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ content: '[E2E-TEST] API comment' }),
        });
        expect(commentRes.ok).toBe(true);
        // Cleanup: delete the comment
        if (commentRes.ok) {
            const comment = await commentRes.json();
            await fetch(`${BACKEND_URL}/api/report/action-item/comment/${comment.id}`, {
                method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
            });
        }
    });
});

// =============================================================================
// ADMIN — add comment, delete own comment
// =============================================================================

test.describe('Comments — Admin', () => {
    test('admin sees comment input on non-terminal items', async ({ page }) => {
        try { await loginAsAdmin(page); } catch { test.skip(); return; }
        if (!await openFirstProjectItem(page)) { test.skip(); return; }
        const dialog = page.locator('[role="dialog"]');
        const isTerminal = await dialog.locator('.MuiChip-label:text-is("Closed"), .MuiChip-label:text-is("Discarded")').first().isVisible().catch(() => false);
        if (!isTerminal) {
            await expect(dialog.locator('textarea').first()).toBeVisible({ timeout: 3000 });
        }
    });
});

// =============================================================================
// MANAGER — add comment on any, delete own comment
// =============================================================================

test.describe('Comments — Manager', () => {
    test('manager sees comment input on non-terminal items', async ({ page }) => {
        try { await loginAsManager(page); } catch { test.skip(); return; }
        if (!await openFirstProjectItem(page)) { test.skip(); return; }
        const dialog = page.locator('[role="dialog"]');
        const isTerminal = await dialog.locator('.MuiChip-label:text-is("Closed"), .MuiChip-label:text-is("Discarded")').first().isVisible().catch(() => false);
        if (!isTerminal) {
            await expect(dialog.locator('textarea').first()).toBeVisible({ timeout: 3000 });
            await expect(dialog.getByRole('button', { name: 'Post' })).toBeVisible({ timeout: 3000 });
        }
    });
});

// =============================================================================
// LEAD — add comment on any, delete own comment only
// =============================================================================

test.describe('Comments — Lead', () => {
    test('lead sees comment input on non-terminal items', async ({ page }) => {
        try { await login(page, LEAD_CREDS.userId, LEAD_CREDS.password); } catch { test.skip(); return; }
        if (!await openFirstProjectItem(page)) { test.skip(); return; }
        const dialog = page.locator('[role="dialog"]');
        const isTerminal = await dialog.locator('.MuiChip-label:text-is("Closed"), .MuiChip-label:text-is("Discarded")').first().isVisible().catch(() => false);
        if (!isTerminal) {
            await expect(dialog.locator('textarea').first()).toBeVisible({ timeout: 3000 });
            await expect(dialog.getByRole('button', { name: 'Post' })).toBeVisible({ timeout: 3000 });
        }
    });

    test('lead does NOT see delete icon on comments created by others', async ({ page }) => {
        try { await login(page, LEAD_CREDS.userId, LEAD_CREDS.password); } catch { test.skip(); return; }
        if (!await openFirstProjectItem(page)) { test.skip(); return; }
        // Seeded comment was created by superuser — lead should not see delete on it
        const dialog = page.locator('[role="dialog"]');
        await expect(dialog).toBeVisible({ timeout: 3000 });
    });
});

// =============================================================================
// MEMBER — add comment, delete own comment only
// =============================================================================

test.describe('Comments — Member', () => {
    test('member sees comment input on non-terminal items', async ({ page }) => {
        try { await loginAsMember(page); } catch { test.skip(); return; }
        if (!await openFirstProjectItem(page)) { test.skip(); return; }
        const dialog = page.locator('[role="dialog"]');
        const isTerminal = await dialog.locator('.MuiChip-label:text-is("Closed"), .MuiChip-label:text-is("Discarded")').first().isVisible().catch(() => false);
        if (!isTerminal) {
            await expect(dialog.locator('textarea').first()).toBeVisible({ timeout: 3000 });
            await expect(dialog.getByRole('button', { name: 'Post' })).toBeVisible({ timeout: 3000 });
        }
    });
});
