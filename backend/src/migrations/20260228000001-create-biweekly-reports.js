'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('biweekly_reports', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                allowNull: false
            },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'projects', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            title: {
                type: Sequelize.STRING,
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
            health: {
                type: Sequelize.STRING,
                allowNull: false,
                defaultValue: 'Green'
            },
            sprints: {
                type: Sequelize.JSONB,
                allowNull: false,
                defaultValue: []
            },
            key_highlights: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            milestone_progress: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            sprint_goals: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            action_items: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            risks: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            discussion_points: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            quality_metrics: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            team_composition: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            individual_contribution: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            ai_adoption_data: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            copilot_usage_stats: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            team_scorecard: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: []
            },
            created_by_user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('NOW()')
            },
            updated_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('NOW()')
            }
        });

        await queryInterface.addIndex('biweekly_reports', ['project_id'], {
            name: 'biweekly_reports_project_id_idx'
        });

        await queryInterface.addIndex('biweekly_reports', ['start_date', 'end_date'], {
            name: 'biweekly_reports_date_range_idx'
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('biweekly_reports');
    }
};
