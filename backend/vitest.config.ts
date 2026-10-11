import { defineConfig } from 'vitest/config';

/**
 * Default suite: unit tests only. Fast, offline, no database.
 *
 * The integration tests live alongside them but need a real Postgres and a TypeScript transform that
 * emits decorator metadata, so they run under vitest.integration.config.ts via `npm run
 * test:integration`. Without this exclusion `vitest run` would collect them and fail on connection.
 */
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Both integration suites need a real Postgres and the decorator-metadata
      // transform, so they run only under vitest.integration.config.ts. Without
      // these exclusions `vitest run` collects them and fails on connection.
      'src/modules/datasource/__tests__/integration/**',
      'src/modules/performanceReview/__tests__/integration/**',
    ],
  },
});
