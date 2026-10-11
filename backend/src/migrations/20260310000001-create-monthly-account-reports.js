'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('monthly_account_reports', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            account_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: {
                    model: 'accounts',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            month: {
                type: Sequelize.INTEGER,
                allowNull: false
            },
            year: {
                type: Sequelize.INTEGER,
                allowNull: false
            },
            summary: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            risks: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: { summary: '', items: [] }
            },
            health: {
                type: Sequelize.STRING,
                allowNull: true
            },
            key_accomplishments: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            red_projects: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            projects_included: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            projects_missing: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            action_items: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            file_path: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            manager_insights: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            original_executive_summary: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updated_at: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });

        await queryInterface.addIndex('monthly_account_reports', ['account_id', 'month', 'year'], {
            unique: true,
            name: 'unique_monthly_account_report'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('monthly_account_reports');
    }
};
