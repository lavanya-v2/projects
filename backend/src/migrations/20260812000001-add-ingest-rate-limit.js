'use strict';

/**
 * ADDENDUM 11 Phase 1 — server-side ingest rate limit. A single mutable global
 * setting row (seeded to once/day) plus a per-token override column, so an admin
 * can loosen the limit for one developer's token without weakening it for everyone.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('ingest_rate_limit_setting', {
            id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
            min_interval_minutes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1440 },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        });
        await queryInterface.bulkInsert('ingest_rate_limit_setting', [
            { min_interval_minutes: 1440, updated_at: new Date() },
        ]);

        await queryInterface.addColumn('usage_ingest_tokens', 'min_interval_minutes_override', {
            type: Sequelize.INTEGER,
            allowNull: true,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('usage_ingest_tokens', 'min_interval_minutes_override');
        await queryInterface.dropTable('ingest_rate_limit_setting');
    },
};
