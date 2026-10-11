'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('monitored_org', {
            id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
            org_uuid: { type: Sequelize.STRING(64), allowNull: false, unique: true },
            org_name: { type: Sequelize.STRING(160), allowNull: true },
            enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
            first_seen_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        });

        // Stamp each daily row with the customer org it was attributed to.
        await queryInterface.addColumn('claude_usage_daily', 'org_uuid', {
            type: Sequelize.STRING(64),
            allowNull: true,
        });
        await queryInterface.addIndex('claude_usage_daily', ['org_uuid'], {
            name: 'claude_usage_daily_org_uuid_idx',
        });
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('claude_usage_daily', 'claude_usage_daily_org_uuid_idx');
        await queryInterface.removeColumn('claude_usage_daily', 'org_uuid');
        await queryInterface.dropTable('monitored_org');
    },
};
