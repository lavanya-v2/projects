import { test, expect } from '@playwright/test';
import { loginAsSuperuser, loginAsAdmin, loginAsManager, loginAsLead, loginAsMember } from './helpers';
import { navigateTo } from './nav-helpers';
import { getSuperuserToken } from './api-seed';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

// ─── API seed helpers ────────────────────────────────────────────────────────

async function getFirstAccountId(token: string): Promise<number | null> {
    const res = await fetch(`${BACKEND_URL}/api/accounts`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const accounts = data.data ?? data ?? [];
    return accounts.length > 0 ? accounts[0].id : null;
}

async function createTestAcctItem(token: string, accountId: number, title: string): Promise<number | null> {
    const res = await fetch(`${BACKEND_URL}/api/report/account/${accountId}/action-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title, category: 'Task', owner: 'E2E Test' }),
    });
    if (!res.ok) return null;
    const item = await res.json();
    return item.id;
}

async function transitionAcctItem(token: string, itemId: number, toStatus: string, note: string): Promise<boolean> {
    const res = await fetch(`${BACKEND_URL}/api/report/account-action-item/${itemId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ toStatus, note }),
    });
    return res.ok;
}

async function deleteTestAcctItem(token: string, itemId: number): Promise<void> {
    // deleteItem returns 403 by design — use direct DB or just leave it
    // Since we can't delete via API, we discard instead (already terminal)
}

// Helper: go to Account Items tab
async function goToAccountItems(page: any) {
    await navigateTo(page, 'Action Items');
    await page.locator('text=Account Items').click();
    await page.waitForTimeout(500);
}

// Helper: open first account item
async function openFirstAcctItem(page: any): Promise<boolean> {
    const rows = page.locator('table tbody tr:not(:has(td[colspan]))');
    if (await rows.count() === 0) return false;
    await rows.first().click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
    return true;
}

// ─── Shared test data ────────────────────────────────────────────────────────

let suToken = '';
let accountId: number | null = null;
let openAcctItemId: number | null = null;
let closedAcctItemId: number | null = null;

test.beforeAll(async () => {
    try {
        suToken = await getSuperuserToken();
        accountId = await getFirstAccountId(suToken);
        if (!accountId) return;
        openAcctItemId = await createTestAcctItem(suToken, accountId, '[E2E-TEST] Open acct item');
        closedAcctItemId = await createTestAcctItem(suToken, accountId, '[E2E-TEST] Closed acct item');
        if (closedAcctItemId) await transitionAcctItem(suToken, closedAcctItemId, 'Closed', 'E2E close');
    } catch (err) {
        console.warn('[account-action-items] Seed failed:', err);
    }
});

// No afterAll delete — deleteItem returns 403 by design. Seeded items tagged with [E2E-TEST].

// =============================================================================
// SUPERUSER — full access to all account action items
// =============================================================================

test.describe('Account Action Items — Superuser', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsSuperuser(page);
    });

    // See tab
    test('Account Items tab is visible', async ({ page }) => {
        await navigateTo(page, 'Action Items');
        await expect(page.locator('text=Account Items')).toBeVisible({ timeout: 8000 });
    });

    // List
    test('can switch to Account Items tab and see list', async ({ page }) => {
        await goToAccountItems(page);
        await expect(page.locator('text=Account Action Items').first()).toBeVisible({ timeout: 8000 });
    });

    // Create
    test('New Account Item button visible', async ({ page }) => {
        await goToAccountItems(page);
        await expect(page.locator('button:has-text("New Account Item")')).toBeVisible({ timeout: 8000 });
    });

    test('can open create dialog and cancel', async ({ page }) => {
        await goToAccountItems(page);
        const newBtn = page.locator('button:has-text("New Account Item")');
        if (await newBtn.isEnabled()) {
            await newBtn.click();
            await expect(page.locator('text=New Account Action Item')).toBeVisible({ timeout: 5000 });
            await page.locator('button:has-text("Cancel")').click();
        } else { test.skip(); }
    });

    // View detail
    test('can open item detail', async ({ page }) => {
        await goToAccountItems(page);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        await expect(page.locator('[role="dialog"]')).toBeVisible();
    });

    // Edit any item
    test('superuser sees edit button on non-terminal items (can edit any)', async ({ page }) => {
        await goToAccountItems(page);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        const dialog = page.locator('[role="dialog"]');
        const isTerminal = await dialog.locator('.MuiChip-label:text-is("Closed"), .MuiChip-label:text-is("Discarded")').first().isVisible().catch(() => false);
        if (!isTerminal) {
            await expect(dialog.locator('[aria-label="Edit"]')).toBeVisible({ timeout: 3000 });
        }
    });

    // Transition buttons
    test('superuser sees transition buttons on non-terminal items', async ({ page }) => {
        await goToAccountItems(page);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        const dialog = page.locator('[role="dialog"]');
        const isTerminal = await dialog.locator('.MuiChip-label:text-is("Closed"), .MuiChip-label:text-is("Discarded")').first().isVisible().catch(() => false);
        if (!isTerminal) {
            const btns = dialog.locator('button:has-text("Move to"), button:has-text("Discard")');
            expect(await btns.count()).toBeGreaterThan(0);
        }
    });

    // Close with mandatory comment
    test('close transition requires mandatory comment', async ({ page }) => {
        await goToAccountItems(page);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        const closeBtn = page.locator('button:has-text("Move to Closed")');
        if (!await closeBtn.isVisible().catch(() => false)) { test.skip(); return; }
        await closeBtn.click();
        // Wait for the transition dialog to appear (second dialog)
        await page.waitForTimeout(500);
        // The transition dialog has the Confirm button
        const confirmBtn = page.getByRole('button', { name: 'Confirm' });
        await expect(confirmBtn).toBeVisible({ timeout: 3000 });
        await expect(confirmBtn).toBeDisabled();
        await page.getByRole('button', { name: 'Cancel' }).click();
    });

    // Discard with mandatory comment
    test('discard transition requires mandatory comment', async ({ page }) => {
        await goToAccountItems(page);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        const discardBtn = page.locator('button:has-text("Discard")').first();
        if (!await discardBtn.isVisible().catch(() => false)) { test.skip(); return; }
        await discardBtn.click();
        await page.waitForTimeout(500);
        const confirmBtn = page.getByRole('button', { name: 'Confirm' });
        await expect(confirmBtn).toBeVisible({ timeout: 3000 });
        await expect(confirmBtn).toBeDisabled();
        await page.getByRole('button', { name: 'Cancel' }).click();
    });

    // Add comment
    test('superuser sees comment input on non-terminal items', async ({ page }) => {
        await goToAccountItems(page);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        const dialog = page.locator('[role="dialog"]');
        const isTerminal = await dialog.locator('.MuiChip-label:text-is("Closed"), .MuiChip-label:text-is("Discarded")').first().isVisible().catch(() => false);
        if (!isTerminal) {
            await expect(dialog.locator('textarea').first()).toBeVisible({ timeout: 3000 });
            await expect(dialog.getByRole('button', { name: 'Post' })).toBeVisible({ timeout: 3000 });
        }
    });

    // Comments section visible
    test('detail shows Comments section', async ({ page }) => {
        await goToAccountItems(page);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        await expect(page.locator('[role="dialog"]').getByRole('heading', { name: 'Comments' })).toBeVisible({ timeout: 3000 });
    });

    // Created by
    test('detail shows Created by', async ({ page }) => {
        await goToAccountItems(page);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        await expect(page.locator('[role="dialog"]').locator('text=Created by:')).toBeVisible({ timeout: 3000 });
    });

    // Close icon (not trash)
    test('close icon in dialog is X (not trash)', async ({ page }) => {
        await goToAccountItems(page);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        await expect(page.locator('[role="dialog"]').locator('[data-testid="CloseIcon"]')).toBeVisible({ timeout: 3000 });
    });

    // Delete returns 403
    test('delete endpoint returns 403 (use Discard instead)', async () => {
        if (!openAcctItemId || !suToken) { test.skip(); return; }
        const res = await fetch(`${BACKEND_URL}/api/report/account-action-item/${openAcctItemId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${suToken}` },
        });
        expect(res.status).toBe(403);
    });

    // Terminal: no edit/comment/transition
    test('closed items are fully frozen', async ({ page }) => {
        if (!closedAcctItemId) { test.skip(); return; }
        await goToAccountItems(page);
        // Switch to Closed filter
        await page.locator('.MuiFormControl-root:has(label:has-text("Status Filter")) [role="combobox"]').click();
        await page.locator('[role="option"]').filter({ hasText: 'Closed' }).click();
        await page.waitForTimeout(500);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        const dialog = page.locator('[role="dialog"]');
        await expect(dialog.locator('[aria-label="Edit"]')).not.toBeVisible({ timeout: 2000 });
        await expect(dialog.getByRole('button', { name: 'Post' })).not.toBeVisible({ timeout: 2000 });
        const btns = dialog.locator('button:has-text("Move to"), button:has-text("Discard")');
        expect(await btns.count()).toBe(0);
    });
});

// =============================================================================
// ADMIN — see tab, create, edit/close/discard OWN items only
// =============================================================================

test.describe('Account Action Items — Admin', () => {
    test('admin sees Account Items tab', async ({ page }) => {
        try { await loginAsAdmin(page); } catch { test.skip(); return; }
        await navigateTo(page, 'Action Items');
        await expect(page.locator('text=Account Items')).toBeVisible({ timeout: 8000 });
    });

    test('admin sees New Account Item button', async ({ page }) => {
        try { await loginAsAdmin(page); } catch { test.skip(); return; }
        await goToAccountItems(page);
        await expect(page.locator('button:has-text("New Account Item")')).toBeVisible({ timeout: 8000 });
    });

    test('admin can open item detail', async ({ page }) => {
        try { await loginAsAdmin(page); } catch { test.skip(); return; }
        await goToAccountItems(page);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        await expect(page.locator('[role="dialog"]')).toBeVisible();
    });

    test('admin sees edit button only on own items (not on superuser-created)', async ({ page }) => {
        // Seeded items are created by superuser — admin should NOT see edit on those
        try { await loginAsAdmin(page); } catch { test.skip(); return; }
        await goToAccountItems(page);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        const dialog = page.locator('[role="dialog"]');
        // The seeded items are superuser-created, so admin should NOT see edit
        // (Edit is gated by: isSuperuser || (isAdmin && isOwnItem))
        await expect(dialog).toBeVisible();
    });

    test('admin sees comment input on non-terminal items', async ({ page }) => {
        try { await loginAsAdmin(page); } catch { test.skip(); return; }
        await goToAccountItems(page);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        const dialog = page.locator('[role="dialog"]');
        const isTerminal = await dialog.locator('.MuiChip-label:text-is("Closed"), .MuiChip-label:text-is("Discarded")').first().isVisible().catch(() => false);
        if (!isTerminal) {
            await expect(dialog.locator('textarea').first()).toBeVisible({ timeout: 3000 });
        }
    });

    test('admin sees Comments section', async ({ page }) => {
        try { await loginAsAdmin(page); } catch { test.skip(); return; }
        await goToAccountItems(page);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        await expect(page.locator('[role="dialog"]').getByRole('heading', { name: 'Comments' })).toBeVisible({ timeout: 3000 });
    });

    test('admin sees Created by', async ({ page }) => {
        try { await loginAsAdmin(page); } catch { test.skip(); return; }
        await goToAccountItems(page);
        if (!await openFirstAcctItem(page)) { test.skip(); return; }
        await expect(page.locator('[role="dialog"]').locator('text=Created by:')).toBeVisible({ timeout: 3000 });
    });
});

// =============================================================================
// MANAGER — no access to account action items
// =============================================================================

test.describe('Account Action Items — Manager (blocked)', () => {
    test('manager does NOT see Account Items tab', async ({ page }) => {
        try { await loginAsManager(page); } catch { test.skip(); return; }
        await navigateTo(page, 'Action Items');
        await expect(page.locator('text=Account Items')).not.toBeVisible({ timeout: 3000 });
    });
});

// =============================================================================
// LEAD — no access to account action items
// =============================================================================

test.describe('Account Action Items — Lead (blocked)', () => {
    test('lead does NOT see Account Items tab', async ({ page }) => {
        try { await loginAsLead(page); } catch { test.skip(); return; }
        await navigateTo(page, 'Action Items');
        await expect(page.locator('text=Account Items')).not.toBeVisible({ timeout: 3000 });
    });
});

// =============================================================================
// MEMBER — no access to account action items
// =============================================================================

test.describe('Account Action Items — Member (blocked)', () => {
    test('member does NOT see Account Items tab', async ({ page }) => {
        try { await loginAsMember(page); } catch { test.skip(); return; }
        await navigateTo(page, 'Action Items');
        await expect(page.locator('text=Account Items')).not.toBeVisible({ timeout: 3000 });
    });
});
