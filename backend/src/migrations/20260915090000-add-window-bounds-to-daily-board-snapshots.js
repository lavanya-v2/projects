'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // Persist the activity window (start/end) actually used to generate a snapshot,
        // set ONLY on first generation and never overwritten by a later regeneration.
        //
        // Why: getReportDateRange() previously re-derived "was this the original generation
        // time" from the mutable `updated_at` column every single call, using a 24h-grace
        // heuristic. That heuristic silently corrupts on repeated same-day resyncs of past
        // dates: a later resync's `updated_at` can fall inside another resync's grace window,
        // collapsing the effective activity window to the gap between two resyncs instead of
        // that day's true historical boundary -- causing real same-day activity (e.g. a status
        // change, a linked commit) to silently disappear from the report. Nullable so existing
        // rows fall back to the heuristic once (best-effort) and then lock in whatever window
        // that run computes, from then on immune to further resync-order corruption.
        await queryInterface.addColumn('daily_board_snapshots', 'window_start', {
            type: Sequelize.DATE,
            allowNull: true,
        });
        await queryInterface.addColumn('daily_board_snapshots', 'window_end', {
            type: Sequelize.DATE,
            allowNull: true,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('daily_board_snapshots', 'window_start');
        await queryInterface.removeColumn('daily_board_snapshots', 'window_end');
    },
};
