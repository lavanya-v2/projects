'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('weekly_reports', {
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
            start_date: {
                type: Sequelize.DATEONLY,
                allowNull: false
            },
            end_date: {
                type: Sequelize.DATEONLY,
                allowNull: false
            },
            work_summary: {
                type: Sequelize.TEXT
            },
            risks: {
                type: Sequelize.TEXT
            },
            achievements: {
                type: Sequelize.TEXT
            },
            status: {
                type: Sequelize.STRING(50),
                allowNull: false
            },
            additional_notes: {
                type: Sequelize.TEXT
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.fn('NOW')
            },
            updated_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.fn('NOW')
            }
        });

        // Add unique constraint for (project_id, start_date, end_date)
        await queryInterface.addIndex('weekly_reports', ['project_id', 'start_date', 'end_date'], {
            unique: true,
            name: 'unique_weekly_project_date_range'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('weekly_reports');
    }
};
