'use strict';

/**
 * Story points on a developer's still-open tickets in the cycle — DISPLAY ONLY.
 *
 * `sp_carried_over` cannot answer this: it deliberately omits points for a
 * ticket already carried in the previous cycle, so the same work is not counted
 * twice across cycles. Correct for scoring, but it understates pending work
 * badly — on LS Jul 27-31 one developer's carried SP read 4 while he actually
 * held 30 SP open, and another read 0 while holding 6.
 *
 * This column includes those repeat carryovers so the Kanban scorecard can show
 * "SP Pending" in the same units as the rest of the table. It feeds no metric:
 * sp_planned, delivery_pct and execution_score are untouched.
 *
 * Nullable with no backfill — the UI falls back to the open-ticket count on rows
 * synced before this existed. Populates on the next re-sync.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('perf_member_scores', 'sp_open', {
      type: Sequelize.FLOAT,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('perf_member_scores', 'sp_open');
  },
};
