'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('action_item_status_history', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER,
            },
            action_item_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'project_action_items', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            from_status: {
                type: Sequelize.STRING(20),
                allowNull: true,  // NULL on creation event
            },
            to_status: {
                type: Sequelize.STRING(20),
                allowNull: false,
            },
            note: {
                type: Sequelize.TEXT,
                allowNull: true,
            },
            changed_by_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL',
            },
            changed_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });

        await queryInterface.addIndex('action_item_status_history', ['action_item_id']);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('action_item_status_history');
    },
};
