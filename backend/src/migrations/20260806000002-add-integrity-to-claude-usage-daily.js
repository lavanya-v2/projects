'use strict';

/**
 * Integrity signals for each ingested day (ADDENDUM 5). `integrity_status` is 'ok'
 * or 'flagged' (rows that fail hard arithmetic checks are rejected at ingest and
 * never stored). `integrity_flags` holds the anomaly list for the admin Data Quality
 * review. `received_at` is the server receive time (audit / late-submission signal).
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('claude_usage_daily', 'integrity_status', {
            type: Sequelize.STRING(12),
            allowNull: false,
            defaultValue: 'ok',
        });
        await queryInterface.addColumn('claude_usage_daily', 'integrity_flags', {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: [],
        });
        await queryInterface.addColumn('claude_usage_daily', 'received_at', {
            type: Sequelize.DATE,
            allowNull: true,
        });
        await queryInterface.addIndex('claude_usage_daily', ['integrity_status'], {
            name: 'claude_usage_daily_integrity_status_idx',
        });
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('claude_usage_daily', 'claude_usage_daily_integrity_status_idx');
        await queryInterface.removeColumn('claude_usage_daily', 'received_at');
        await queryInterface.removeColumn('claude_usage_daily', 'integrity_flags');
        await queryInterface.removeColumn('claude_usage_daily', 'integrity_status');
    },
};
