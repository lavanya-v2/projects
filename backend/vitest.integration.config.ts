import { defineConfig, type Plugin } from 'vitest/config';
import ts from 'typescript';
import * as dotenv from 'dotenv';

dotenv.config();

const TEST_DB = process.env.DB_NAME_TEST || 'dsr_excel_it';

/**
 * Transform TypeScript with tsc rather than esbuild.
 *
 * The Sequelize models are sequelize-typescript classes whose `@Column` decorators infer the column
 * type from `design:type` metadata. esbuild does not emit decorator metadata at all, so every model
 * throws "cannot be automatically resolved to a sequelize data type" at import. tsc emits it, and it
 * is already a dependency -- no new tooling for the harness.
 *
 * `useDefineForClassFields: false` matters just as much: with class fields defined, `id!: number`
 * would emit an own property of `undefined` and shadow the accessors Sequelize installs.
 */
const typescriptWithDecoratorMetadata = (): Plugin => ({
  name: 'ts-decorator-metadata',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('.ts') || id.includes('node_modules')) {
      return null;
    }

    const out = ts.transpileModule(code, {
      fileName: id,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        useDefineForClassFields: false,
        esModuleInterop: true,
        resolveJsonModule: true,
        sourceMap: true,
      },
    });

    return {
      code: out.outputText,
      map: out.sourceMapText ? JSON.parse(out.sourceMapText) : null,
    };
  },
});

/**
 * Integration suite: real Postgres, real imports, real projection replay.
 *
 * Kept in a separate config so `npm test` stays fast and needs no database. DB_NAME is overridden
 * here because config/connection.ts reads it at module import time -- setting it inside a test would
 * be too late, and the connection would point at the development database.
 */
export default defineConfig({
  plugins: [typescriptWithDecoratorMetadata()],
  // The plugin above has already produced JS; letting esbuild re-transform would strip the metadata.
  esbuild: false,
  test: {
    include: [
      'src/modules/datasource/__tests__/integration/**/*.integration.test.ts',
      'src/modules/performanceReview/__tests__/integration/**/*.integration.test.ts',
    ],
    // One scratch database shared by every integration suite. globalSetup lives
    // under datasource for historical reasons but is generic: it creates, migrates
    // and drops the database, and refuses to run if it points at the dev DB.
    globalSetup: ['src/modules/datasource/__tests__/integration/globalSetup.ts'],
    env: {
      NODE_ENV: 'test',
      DB_NAME: TEST_DB,
      DB_NAME_TEST: TEST_DB,
      // Uploads are retained per import; keep them out of the real upload directory.
      UPLOAD_PATH: '/tmp/dsr-excel-it-uploads',
    },
    // One shared schema, so parallel files would race on truncation between tests.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
