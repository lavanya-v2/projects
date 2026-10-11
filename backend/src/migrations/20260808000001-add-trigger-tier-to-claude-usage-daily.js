'use strict';

/**
 * Records how each reporting machine is triggered ('scheduler' | 'startup' |
 * 'hook' | 'none'), read back from the machine's own OS at collection time.
 *
 * Without it a missing row is ambiguous — a broken schedule and a day off look
 * identical — which is how a fleet-wide scheduling gap stayed invisible. Nullable
 * because collectors predating the scheduler rollout do not report it.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('claude_usage_daily', 'trigger_tier', {
            type: Sequelize.STRING(16),
            allowNull: true,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('claude_usage_daily', 'trigger_tier');
    },
};
