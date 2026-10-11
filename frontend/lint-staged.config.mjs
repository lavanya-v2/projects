/**
 * Frontend lint-staged config.
 *
 * lint-staged discovers the closest config to each staged file, so this only
 * runs for files under frontend/. It runs with cwd = frontend/, and the file
 * paths passed in are relative to frontend/. Local binaries (eslint, tsc, vite)
 * resolve from frontend/node_modules.
 *
 * - eslint runs ONLY on the staged files.
 * - the full build (tsc -b && vite build) is project-wide and runs whenever any
 *   frontend .ts/.tsx is staged.
 */
export default {
  '**/*.{ts,tsx}': (files) => [
    `eslint ${files.join(' ')}`,
    'npm run build',
  ],
};
