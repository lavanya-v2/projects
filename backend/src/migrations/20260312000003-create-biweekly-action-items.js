'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('biweekly_action_items', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER,
            },
            biweekly_report_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'biweekly_reports', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            action_item_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'project_action_items', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            is_carryover: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });

        await queryInterface.addIndex('biweekly_action_items', ['biweekly_report_id']);
        await queryInterface.addIndex('biweekly_action_items', ['action_item_id']);
        await queryInterface.addConstraint('biweekly_action_items', {
            fields: ['biweekly_report_id', 'action_item_id'],
            type: 'unique',
            name: 'biweekly_action_items_unique',
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('biweekly_action_items');
    },
};
