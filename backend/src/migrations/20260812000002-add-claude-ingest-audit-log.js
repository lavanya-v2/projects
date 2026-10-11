'use strict';

/**
 * ADDENDUM 11 Phase 3 — append-only ingest audit log. One row per ingest ATTEMPT
 * (accepted or rejected), unlike claude_usage_daily's upsert-per-day, so re-pushes
 * and repeated failures are preserved as history for troubleshooting/oversight.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('claude_ingest_audit_log', {
            id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
            user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onDelete: 'SET NULL',
            },
            token_id: {
                type: Sequelize.BIGINT,
                allowNull: true,
                references: { model: 'usage_ingest_tokens', key: 'id' },
                onDelete: 'SET NULL',
            },
            day: { type: Sequelize.DATEONLY, allowNull: true },
            ip_address: { type: Sequelize.STRING(64), allowNull: true },
            user_agent: { type: Sequelize.STRING(255), allowNull: true },
            collector_version: { type: Sequelize.STRING(20), allowNull: true },
            org_uuid: { type: Sequelize.STRING(64), allowNull: true },
            outcome: { type: Sequelize.STRING(30), allowNull: false },
            http_status: { type: Sequelize.INTEGER, allowNull: false },
            payload: { type: Sequelize.JSONB, allowNull: true },
            received_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        });
        await queryInterface.addIndex('claude_ingest_audit_log', ['user_id']);
        await queryInterface.addIndex('claude_ingest_audit_log', ['received_at']);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('claude_ingest_audit_log');
    },
};
