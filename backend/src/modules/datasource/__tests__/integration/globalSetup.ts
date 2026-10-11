import { execFileSync } from 'child_process';
import path from 'path';
import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Creates a scratch database for the integration suite, migrates it, and drops it afterwards.
 *
 * The suite exercises real upserts, the unique index on (project_id, sprint_key, ext_id) and the
 * projection replay, none of which can be observed against mocked models. It must never touch the
 * development database: the name is fixed here and asserted against DB_NAME so a misconfigured env
 * fails loudly rather than quietly seeding real data.
 */
const TEST_DB = process.env.DB_NAME_TEST || 'dsr_excel_it';
const BACKEND_ROOT = path.resolve(__dirname, '../../../../..');

function adminClient(): Client {
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    // 'postgres' always exists and is never the target, so CREATE/DROP DATABASE can run.
    database: 'postgres',
  });
}

export async function setup(): Promise<void> {
  if (!process.env.DB_NAME_DEV_GUARD) {
    // Recorded before anything overrides it, so teardown can prove the dev DB was never the target.
    process.env.DB_NAME_DEV_GUARD = process.env.DB_NAME || '';
  }

  if (TEST_DB === process.env.DB_NAME_DEV_GUARD) {
    throw new Error(
      `Refusing to run: the integration database (${TEST_DB}) is the same as the development database.`
    );
  }

  const client = adminClient();
  await client.connect();

  try {
    // Dropped first so a crashed previous run cannot leave state that makes results order-dependent.
    await client.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
    await client.query(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await client.end();
  }

  execFileSync('npx', ['sequelize-cli', 'db:migrate', '--env', 'test'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DB_NAME_TEST: TEST_DB },
    stdio: 'pipe',
  });
}

export async function teardown(): Promise<void> {
  if (process.env.KEEP_TEST_DB === '1') {
    // Escape hatch for inspecting state after a failure.
    return;
  }

  const client = adminClient();
  await client.connect();

  try {
    // Vitest workers may not have released their pool yet; terminating first makes DROP reliable.
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB]
    );
    await client.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
  } finally {
    await client.end();
  }
}
