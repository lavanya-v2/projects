'use strict';

/**
 * Off-board bug counts: standalone Bugs / Sub-bugs a QA member reported within a
 * sprint's date window that were NOT attached to the sprint on the Jira board
 * (so they never entered perf_ticket_facts via the `sprint = {id}` board fetch).
 *
 * Stored in SEPARATE columns (not folded into bugs_raised_count) on purpose:
 * bugs_raised_count feeds quality_rate's in-sprint-catch denominator and the
 * leakage-rate math in perfAggregation. Off-board bugs are neither in-sprint
 * catches nor part of those rates, so mixing them in would distort quality
 * scoring. The member dashboard sums (on-board + off-board) for display only.
 *
 * No backfill is possible — off-board bugs were never ingested, so existing rows
 * stay at 0 until their sprint is re-synced.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('perf_member_scores', 'offboard_bugs_raised_count', {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
        });
        await queryInterface.addColumn('perf_member_scores', 'offboard_sub_bugs_raised_count', {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('perf_member_scores', 'offboard_bugs_raised_count');
        await queryInterface.removeColumn('perf_member_scores', 'offboard_sub_bugs_raised_count');
    },
};
