'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('monthly_project_reports', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: {
                    model: 'projects',
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
            work_summary: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            risks: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            achievements: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            status: {
                type: Sequelize.STRING,
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

        // Add unique index for upsert
        await queryInterface.addIndex('monthly_project_reports', ['project_id', 'month', 'year'], {
            unique: true,
            name: 'unique_monthly_project_report'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('monthly_project_reports');
    }
};
