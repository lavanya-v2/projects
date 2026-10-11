import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    globalSetup: './global-setup.ts',
    globalTeardown: './global-teardown.ts',
    timeout: 30000,
    expect: { timeout: 8000 },
    fullyParallel: false,
    retries: 1,
    reporter: 'list',
    use: {
        baseURL: 'http://localhost:5173',
        headless: true,
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    // Start both servers before running tests. The backend is owned by Playwright
    // so it always launches with the E2E mock env vars active (emails short-
    // circuit at the transport layer; notifications dispatch is a no-op).
    // reuseExistingServer: false on the backend means Playwright refuses to run
    // if a non-mock backend is already bound to :3000 — intentional fail-fast.
    webServer: [
        {
            command: 'cd ../frontend && npm run dev',
            url: 'http://localhost:5173',
            reuseExistingServer: true,
            timeout: 60_000,
        },
        {
            command: 'cd ../backend && E2E_TESTING=true NOTIFICATIONS_ENABLED=false npm run dev',
            url: 'http://localhost:3000/api/health',
            reuseExistingServer: false,
            timeout: 180_000,
        },
    ],
});
