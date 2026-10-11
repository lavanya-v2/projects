'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('program_action_items', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER,
            },
            program_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'programs', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            title: {
                type: Sequelize.STRING(500),
                allowNull: false,
            },
            category: {
                type: Sequelize.STRING(50),
                allowNull: false,
            },
            owner: {
                type: Sequelize.STRING(255),
                allowNull: false,
            },
            status: {
                type: Sequelize.STRING(20),
                allowNull: false,
                defaultValue: 'Open',
            },
            due_date: {
                type: Sequelize.DATEONLY,
                allowNull: true,
            },
            created_by_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL',
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
            updated_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });

        await queryInterface.addIndex('program_action_items', ['program_id']);
        await queryInterface.addIndex('program_action_items', ['status']);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('program_action_items');
    },
};
