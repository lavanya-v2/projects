/**
 * One-shot backfill for the 3 weekdays in May 2026 where Program Daily reports
 * were generated empty (cron fired before DSR snapshots existed).
 *
 * Hard-coded date list — May 1, 4, 5. Skips weekends entirely (no DSR data
 * for those dates by design).
 *
 * Usage:
 *   cd backend && npm run build
 *   node scripts/backfill-program-daily-may.js                # all programs
 *   node scripts/backfill-program-daily-may.js --programId 1  # one program
 *
 * Calls the same service the queue worker uses, with forceRefresh=true, so
 * any existing empty rows are overwritten.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sequelize = require('../dist/config/connection').default;
const { Program } = require('../dist/models/Program');
const { programDailyReportService } = require('../dist/modules/reports/services/programDailyReportService');

const DATES = ['2026-05-01', '2026-05-04', '2026-05-05'];

const args = process.argv.slice(2);
const programIdArgIdx = args.indexOf('--programId');
const PROGRAM_ID = programIdArgIdx >= 0 ? Number(args[programIdArgIdx + 1]) : null;

async function main() {
    console.log('Connecting to DB…');
    await sequelize.authenticate();

    const where = PROGRAM_ID ? { id: PROGRAM_ID } : {};
    const programs = await Program.findAll({ where, order: [['accountId', 'ASC'], ['name', 'ASC']] });
    if (programs.length === 0) {
        console.log('No programs match. Nothing to do.');
        return;
    }

    console.log(`Backfilling dates: ${DATES.join(', ')}`);
    console.log(`Programs to process: ${programs.length}\n`);

    for (const p of programs) {
        console.log(`── ${p.name} (id=${p.id}, accountId=${p.accountId}) ──`);
        for (const d of DATES) {
            try {
                await programDailyReportService.generateDailyProgramReport(p.id, d, true);
                console.log(`  ✓ ${d}`);
            } catch (err) {
                if (err && err.statusCode === 422) {
                    console.log(`  · ${d} skipped (${err.message})`);
                } else {
                    console.error(`  ✗ ${d}: ${err && err.message ? err.message : err}`);
                }
            }
        }
    }

    console.log('\nDone.');
}

main()
    .catch(err => {
        console.error('Fatal:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        try { await sequelize.close(); } catch (_) { /* ignore */ }
    });
