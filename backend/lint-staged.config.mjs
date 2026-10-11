/**
 * Backend lint-staged config.
 *
 * lint-staged discovers the closest config to each staged file, so this only
 * runs for files under backend/. It runs with cwd = backend/, and the file
 * paths passed in are relative to backend/. Local binaries (eslint, prettier,
 * tsc) resolve from backend/node_modules.
 *
 * - typecheck is project-wide (tsc reads tsconfig.json, so it can't be scoped
 *   to individual files) and runs whenever any backend .ts is staged.
 * - eslint and prettier run ONLY on the staged source files, so a commit isn't
 *   blocked by pre-existing issues in files it didn't touch.
 */
export default {
  // Project-wide type check on any staged backend TypeScript.
  '**/*.ts': () => 'npm run typecheck',

  // Lint + format only the staged source files.
  'src/**/*.ts': (files) => [
    `eslint ${files.join(' ')}`,
    `prettier --check ${files.join(' ')}`,
  ],
};
