#!/usr/bin/env node
'use strict';

/**
 * Clear all Excel/CSV data for an account, leaving the projects themselves in place.
 *
 * Removes: column mappings (every version), imports and their ledger rows, the derived ticket-state
 * projection, sprints created from uploads, Team Performance rows, and the retained files on disk.
 * Keeps: the account, its projects, and everything not fed by an Excel upload.
 *
 * Runs against whatever DB_NAME in .env points at, and refuses to start if that database is missing
 * the Excel schema -- the database rolls over periodically, and a fresh one has the migrations
 * pending, where a "successful" run would silently clear nothing.
 *
 * Dry run by default. Nothing is written or deleted without --apply.
 *
 *   node scripts/clear-excel-data.js                       # preview for ENTELECT
 *   node scripts/clear-excel-data.js --account ENT_TWO     # preview another account
 *   node scripts/clear-excel-data.js --apply               # do it
 *   node scripts/clear-excel-data.js --apply --keep-files  # DB only, leave uploads on disk
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const ACCOUNT_CODE = value('account', 'ENTELECT');
const APPLY = flag('apply');
const KEEP_FILES = flag('keep-files');

const UPLOAD_ROOT = process.env.UPLOAD_PATH
  ? path.resolve(process.env.UPLOAD_PATH)
  : path.join(__dirname, '..', '..', 'uploads');

/** Tables that must exist before this can do its job. */
const REQUIRED_TABLES = ['template_mappings', 'excel_imports', 'excel_work_items', 'excel_ticket_state'];

/**
 * Child-first, so nothing is orphaned mid-transaction.
 * `scope` says how each table reaches the projects being cleared.
 */
const DELETIONS = [
  { table: 'excel_status_history', scope: 'import' },
  { table: 'excel_work_items', scope: 'import' },
  { table: 'excel_ticket_state', scope: 'project' },
  { table: 'excel_imports', scope: 'project' },
  { table: 'project_sprints', scope: 'project' },
  // Empty for Excel projects today -- the Jira sync populates these -- but cleared so a project that
  // was ever synced does not keep stale Team Performance rows behind the Board View.
  { table: 'perf_ticket_facts', scope: 'project' },
  { table: 'perf_member_scores', scope: 'project' },
  { table: 'perf_sprint_syncs', scope: 'project' },
];

/** True when `target` sits inside `root`, so deletion can never escape the upload directory. */
function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function client() {
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME,
  });
}

async function tableExists(db, table) {
  const { rowCount } = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  return rowCount > 0;
}

async function countIn(db, table, column, ids) {
  if (ids.length === 0 || !(await tableExists(db, table))) {
    return 0;
  }
  const { rows } = await db.query(`SELECT COUNT(*)::int AS c FROM "${table}" WHERE ${column} = ANY($1)`, [ids]);
  return rows[0].c;
}

async function main() {
  const db = client();
  await db.connect();

  console.log(`database : ${process.env.DB_NAME}`);
  console.log(`account  : ${ACCOUNT_CODE}`);
  console.log(`mode     : ${APPLY ? 'APPLY — data will be deleted' : 'dry run (pass --apply to execute)'}\n`);

  // Preflight. A rolled-over database has these migrations pending, and clearing "successfully"
  // against it would report zero everywhere while the real data sat in the previous database.
  const missing = [];
  for (const table of REQUIRED_TABLES) {
    if (!(await tableExists(db, table))) {
      missing.push(table);
    }
  }

  if (missing.length > 0) {
    console.error(`This database is missing: ${missing.join(', ')}`);
    console.error('The Excel migrations have not been run here. Run them first:\n');
    console.error('  npx sequelize-cli db:migrate\n');
    await db.end();
    process.exit(1);
  }

  const { rows: accounts } = await db.query('SELECT id, name, code FROM accounts WHERE code = $1', [
    ACCOUNT_CODE,
  ]);

  if (accounts.length === 0) {
    const { rows: available } = await db.query('SELECT code, name FROM accounts ORDER BY code');
    console.error(`No account with code "${ACCOUNT_CODE}". Available:`);
    available.forEach(a => console.error(`  ${a.code.padEnd(12)} ${a.name}`));
    await db.end();
    process.exit(1);
  }

  const account = accounts[0];
  const { rows: projects } = await db.query(
    'SELECT id, name, code, data_source_type FROM projects WHERE account_id = $1 ORDER BY id',
    [account.id]
  );

  const projectIds = projects.map(p => p.id);

  console.log(`${account.name} (id ${account.id}) — ${projects.length} project(s)`);
  projects.forEach(p => console.log(`  ${String(p.id).padStart(3)}  ${p.name} [${p.data_source_type}]`));
  console.log();

  if (projectIds.length === 0) {
    console.log('Nothing to do.');
    await db.end();
    return;
  }

  const { rows: importRows } = await db.query(
    'SELECT id, storage_path FROM excel_imports WHERE project_id = ANY($1)',
    [projectIds]
  );
  const importIds = importRows.map(r => r.id);

  const { rows: mappingRows } = await db.query(
    'SELECT id, storage_path FROM template_mappings WHERE project_id = ANY($1)',
    [projectIds]
  );

  // What will go, counted before anything is touched, so the dry run and the real run agree.
  console.log('to delete:');
  for (const { table, scope } of DELETIONS) {
    const ids = scope === 'import' ? importIds : projectIds;
    const column = scope === 'import' ? 'import_id' : 'project_id';
    console.log(`  ${table.padEnd(22)} ${await countIn(db, table, column, ids)}`);
  }
  console.log(`  ${'template_mappings'.padEnd(22)} ${mappingRows.length}`);

  const retained = [...importRows, ...mappingRows].map(r => r.storage_path).filter(Boolean);
  const deletable = retained.filter(p => isInside(UPLOAD_ROOT, p));
  const foreign = retained.length - deletable.length;

  console.log(
    `  ${'retained files'.padEnd(22)} ${deletable.length}${KEEP_FILES ? ' (kept — --keep-files)' : ''}`
  );

  if (foreign > 0) {
    console.log(`  ${'(outside upload dir)'.padEnd(22)} ${foreign} — will NOT be touched`);
  }

  console.log(`  upload dir: ${UPLOAD_ROOT}`);
  console.log();

  if (!APPLY) {
    console.log('Dry run — nothing changed. Re-run with --apply to delete.');
    await db.end();
    return;
  }

  await db.query('BEGIN');

  try {
    for (const { table, scope } of DELETIONS) {
      if (!(await tableExists(db, table))) {
        continue;
      }

      const ids = scope === 'import' ? importIds : projectIds;
      const column = scope === 'import' ? 'import_id' : 'project_id';

      if (ids.length === 0) {
        continue;
      }

      const { rowCount } = await db.query(`DELETE FROM "${table}" WHERE ${column} = ANY($1)`, [ids]);
      console.log(`  deleted ${String(rowCount).padStart(5)}  ${table}`);
    }

    // The FK from projects has to be released before the mappings themselves can go.
    await db.query('UPDATE projects SET template_mapping_id = NULL WHERE id = ANY($1)', [projectIds]);
    const { rowCount: mappingsDeleted } = await db.query(
      'DELETE FROM template_mappings WHERE project_id = ANY($1)',
      [projectIds]
    );
    console.log(`  deleted ${String(mappingsDeleted).padStart(5)}  template_mappings`);

    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    console.error('\nRolled back — nothing was deleted.');
    console.error(e.message);
    await db.end();
    process.exit(1);
  }

  // Files only after the transaction commits: a rolled-back run must not leave rows pointing at
  // files that are already gone.
  if (!KEEP_FILES) {
    let removed = 0;
    let skipped = 0;

    for (const filePath of retained) {
      // storage_path is absolute and was written by whichever environment did the upload, so it can
      // point outside the upload directory this run is configured with -- which is exactly what
      // happens when rehearsing against a copy of the database. Deleting it then would destroy the
      // real files the original database still references. Only ever delete inside UPLOAD_ROOT.
      if (!isInside(UPLOAD_ROOT, filePath)) {
        skipped += 1;
        continue;
      }

      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
        removed += 1;
      }
    }

    if (skipped > 0) {
      console.log(
        `  skipped ${String(skipped).padStart(5)}  file(s) outside ${UPLOAD_ROOT} — left alone deliberately`
      );
    }

    for (const id of projectIds) {
      const dir = path.join(UPLOAD_ROOT, 'projects', String(id));
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    console.log(`  deleted ${String(removed).padStart(5)}  retained files (and their project folders)`);
  }

  console.log(`\nDone. ${projects.length} project(s) kept, with no mapping and no imported data.`);
  console.log('Next: set up a column mapping per project, then upload.');

  await db.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
