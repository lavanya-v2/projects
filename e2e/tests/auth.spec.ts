import { test, expect } from '@playwright/test';
import { SUPERUSER_CREDS } from './helpers';

test.describe('Authentication', () => {
    test('valid login shows dashboard', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('text=Welcome back', { timeout: 10000 });

        await page.locator('input[type="text"]').first().fill(SUPERUSER_CREDS.userId);
        await page.locator('input[type="password"]').first().fill(SUPERUSER_CREDS.password);
        await page.getByRole('button', { name: /sign in/i }).click();

        // After login the Login form disappears and Dashboard is shown (SPA — URL stays at /)
        await expect(page.locator('text=Dashboard').first()).toBeVisible({ timeout: 10000 });
    });

    test('invalid credentials shows error', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('text=Welcome back', { timeout: 10000 });

        await page.locator('input[type="text"]').first().fill('wrong@email.com');
        await page.locator('input[type="password"]').first().fill('wrongpassword');
        await page.getByRole('button', { name: /sign in/i }).click();

        // Error message should appear
        await expect(page.locator('[role="alert"], .MuiAlert-root')).toBeVisible({ timeout: 8000 });
    });

    test('session expired redirect shows message', async ({ page }) => {
        await page.goto('/?expired=true');
        await expect(page.locator('text=session has expired')).toBeVisible({ timeout: 8000 });
    });
});
