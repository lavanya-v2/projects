'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('account_weekly_reports', {
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
            week_number: {
                type: Sequelize.INTEGER,
                allowNull: false
            },
            year: {
                type: Sequelize.INTEGER,
                allowNull: false
            },
            start_date: {
                type: Sequelize.DATEONLY,
                allowNull: false
            },
            end_date: {
                type: Sequelize.DATEONLY,
                allowNull: false
            },
            summary: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            risks: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            health: {
                type: Sequelize.STRING,
                allowNull: true
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
            created_at: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updated_at: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });

        // Add unique index for upsert
        await queryInterface.addIndex('account_weekly_reports', ['account_id', 'week_number', 'year'], {
            unique: true,
            name: 'unique_account_weekly_report'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('account_weekly_reports');
    }
};
