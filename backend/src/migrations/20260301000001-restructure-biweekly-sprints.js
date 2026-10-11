'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // 1. Drop existing biweekly_reports table
        await queryInterface.dropTable('biweekly_reports');

        // 2. Create sprints table
        await queryInterface.createTable('sprints', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                allowNull: false,
            },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'projects', key: 'id' },
                onDelete: 'CASCADE',
            },
            name: {
                type: Sequelize.STRING,
                allowNull: false,
            },
            start_date: {
                type: Sequelize.DATEONLY,
                allowNull: false,
            },
            end_date: {
                type: Sequelize.DATEONLY,
                allowNull: false,
            },
            is_kanban_period: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            metrics: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: {},
            },
            goals: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            team_members: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            quality_metrics: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: {},
            },
            ai_adoption_data: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            copilot_usage_stats: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
            updated_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });

        await queryInterface.addIndex('sprints', ['project_id'], {
            name: 'sprints_project_id_idx',
        });
        await queryInterface.addIndex('sprints', ['end_date'], {
            name: 'sprints_end_date_idx',
        });

        // 3. Create new biweekly_reports table (meeting-centric)
        await queryInterface.createTable('biweekly_reports', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                allowNull: false,
            },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'projects', key: 'id' },
                onDelete: 'CASCADE',
            },
            created_by_user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onDelete: 'SET NULL',
            },
            title: {
                type: Sequelize.STRING,
                allowNull: false,
            },
            meeting_date: {
                type: Sequelize.DATEONLY,
                allowNull: false,
            },
            start_date: {
                type: Sequelize.DATEONLY,
                allowNull: false,
            },
            end_date: {
                type: Sequelize.DATEONLY,
                allowNull: false,
            },
            health: {
                type: Sequelize.STRING,
                allowNull: false,
                defaultValue: 'Green',
            },
            key_highlights: {
                type: Sequelize.JSONB,
                allowNull: true,
            },
            milestone_progress: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            action_items: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            risks: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            discussion_points: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
            updated_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });

        await queryInterface.addIndex('biweekly_reports', ['project_id'], {
            name: 'biweekly_reports_project_id_idx',
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable('biweekly_reports');
        await queryInterface.dropTable('sprints');

        // Recreate original biweekly_reports table (minimal rollback)
        await queryInterface.createTable('biweekly_reports', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                allowNull: false,
            },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'projects', key: 'id' },
                onDelete: 'CASCADE',
            },
            created_by_user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onDelete: 'SET NULL',
            },
            title: { type: Sequelize.STRING, allowNull: false },
            start_date: { type: Sequelize.DATEONLY, allowNull: false },
            end_date: { type: Sequelize.DATEONLY, allowNull: false },
            health: { type: Sequelize.STRING, allowNull: false, defaultValue: 'Green' },
            sprints: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            key_highlights: { type: Sequelize.JSONB, allowNull: true },
            milestone_progress: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            sprint_goals: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            action_items: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            risks: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            discussion_points: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            quality_metrics: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            team_composition: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            individual_contribution: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            ai_adoption_data: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            copilot_usage_stats: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            team_scorecard: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
            updated_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });
    },
};
