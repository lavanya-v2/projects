import { Page } from '@playwright/test';

// Test credentials — seeded via backend/src/seeders/20260216000002-seed-superuser.js
export const SUPERUSER_CREDS = { userId: 'superuser', password: 'V2CCMH@superUser' };
// Add manager/lead/admin/member credentials if available in dev
export const ADMIN_CREDS = { userId: 'admin@v2solutions.com', password: 'password123' };
export const MANAGER_CREDS = { userId: 'manager@v2solutions.com', password: 'password123' };
export const LEAD_CREDS = { userId: 'lead@v2solutions.com', password: 'password123' };
export const MEMBER_CREDS = { userId: 'member@v2solutions.com', password: 'password123' };

export async function login(page: Page, userId: string, password: string) {
    await page.goto('/');
    // New "Lens" login page heading
    await page.waitForSelector('text=Welcome back', { timeout: 10000 });

    // The login form uses raw HTML inputs (not labelled MUI fields)
    await page.locator('input[type="text"]').first().fill(userId);
    await page.locator('input[type="password"]').first().fill(password);

    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait for the login heading to disappear (SPA — URL does not change)
    await page.waitForSelector('text=Welcome back', { state: 'hidden', timeout: 15000 });
    await page.waitForLoadState('networkidle');
}

export async function loginAsSuperuser(page: Page) {
    await login(page, SUPERUSER_CREDS.userId, SUPERUSER_CREDS.password);
}

export async function loginAsAdmin(page: Page) {
    await login(page, ADMIN_CREDS.userId, ADMIN_CREDS.password);
}

export async function loginAsManager(page: Page) {
    await login(page, MANAGER_CREDS.userId, MANAGER_CREDS.password);
}

export async function loginAsLead(page: Page) {
    await login(page, LEAD_CREDS.userId, LEAD_CREDS.password);
}

export async function loginAsMember(page: Page) {
    await login(page, MEMBER_CREDS.userId, MEMBER_CREDS.password);
}
