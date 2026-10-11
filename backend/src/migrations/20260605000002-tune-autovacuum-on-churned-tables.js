'use strict';

/**
 * Tighten autovacuum on upsert / regeneration-heavy tables.
 *
 * These tables are written by upsert or full regenerate (not append-only), so
 * every rewrite leaves dead tuples (Postgres MVCC). The default
 * autovacuum_vacuum_scale_factor = 0.20 lets a table reach ~20% dead before
 * autovacuum reclaims it, which means steady on-disk bloat between runs. Lowering
 * to 0.05 makes autovacuum kick in at ~5% dead, keeping these tables tight as
 * project/account count grows. analyze scale_factor lowered too so the planner
 * keeps fresh stats.
 *
 * This only changes WHEN autovacuum runs; it does not reclaim existing bloat.
 * To return already-bloated space to the OS, run a one-time VACUUM FULL (or
 * pg_repack) per table in a maintenance window -- VACUUM FULL takes an exclusive
 * lock and cannot run inside a migration transaction, so it is intentionally
 * NOT done here. See the project notes / plan for the manual command.
 *
 * @type {import('sequelize-cli').Migration}
 */

const TABLES = [
    'daily_board_snapshots',
    'project_weekly_reports',
    'account_weekly_reports',
    'monthly_project_reports',
    'monthly_account_reports',
    'program_daily_reports',
    'program_weekly_reports',
    'program_monthly_reports',
    'perf_ticket_facts',
    'perf_member_scores',
];

module.exports = {
    async up(queryInterface) {
        for (const table of TABLES) {
            await queryInterface.sequelize.query(
                'ALTER TABLE "' + table + '" SET (' +
                'autovacuum_vacuum_scale_factor = 0.05, ' +
                'autovacuum_analyze_scale_factor = 0.05)'
            );
        }
    },

    async down(queryInterface) {
        for (const table of TABLES) {
            await queryInterface.sequelize.query(
                'ALTER TABLE "' + table + '" RESET (' +
                'autovacuum_vacuum_scale_factor, ' +
                'autovacuum_analyze_scale_factor)'
            );
        }
    },
};
