'use strict';

/**
 * The honest "when did this account actually start using Performance Review"
 * fact. `created_at` can't reliably serve this — re-saving config doesn't move
 * it, and a config that gets disabled/re-enabled shouldn't look freshly
 * started. Set once, at first creation, and never touched again.
 *
 * Nullable on purpose: existing accounts that already backfilled their full
 * fiscal year (set up before this column existed) get no default — this is an
 * opt-in for new setups, not retroactive. `generateCycles` and `GET /cycles`
 * both fall back to today's pre-column behavior when it's null.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('review_cycle_configs', 'setup_date', {
            type: Sequelize.DATEONLY,
            allowNull: true,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('review_cycle_configs', 'setup_date');
    },
};
