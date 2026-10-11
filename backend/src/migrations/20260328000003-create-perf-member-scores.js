'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('perf_member_scores', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER,
            },
            sync_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'perf_sprint_syncs', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'projects', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            jira_login_id: {
                type: Sequelize.STRING(255),
                allowNull: false,
            },
            display_name: {
                type: Sequelize.STRING(255),
                allowNull: false,
            },
            member_category: {
                type: Sequelize.STRING(50),
                allowNull: false,
                defaultValue: 'developer',
            },
            // Developer metrics
            sp_planned: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            sp_done: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            sp_carried_over: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            delivered_count: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            spillover_count: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            reopened_count: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            reopen_rate_pct: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            delivery_pct: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            avg_cycle_time_hours: {
                type: Sequelize.FLOAT,
                allowNull: true,
            },
            execution_score: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            // QA metrics
            bugs_raised_count: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            bugs_by_priority: {
                type: Sequelize.JSONB,
                allowNull: false,
                defaultValue: {},
            },
            weighted_bug_score: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            tickets_tested_count: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            avg_qa_cycle_time_hours: {
                type: Sequelize.FLOAT,
                allowNull: true,
            },
            prod_bugs_escaped: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            bug_escape_rate_pct: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            quality_rate: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            // Lead overrides
            overridden_metrics: {
                type: Sequelize.JSONB,
                allowNull: false,
                defaultValue: {},
            },
            override_reason: {
                type: Sequelize.TEXT,
                allowNull: true,
            },
            overridden_by_user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL',
            },
            is_overridden: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
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

        await queryInterface.addIndex('perf_member_scores', ['sync_id']);
        await queryInterface.addIndex('perf_member_scores', ['project_id']);
        await queryInterface.addIndex('perf_member_scores', ['sync_id', 'jira_login_id'], {
            unique: true,
            name: 'perf_member_scores_sync_member_unique',
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('perf_member_scores');
    },
};
