'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('perf_ticket_facts', {
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
            jira_key: {
                type: Sequelize.STRING(50),
                allowNull: false,
            },
            summary: {
                type: Sequelize.STRING(500),
                allowNull: true,
            },
            issue_type: {
                type: Sequelize.STRING(100),
                allowNull: true,
            },
            assignee_jira_id: {
                type: Sequelize.STRING(255),
                allowNull: true,
            },
            assignee_name: {
                type: Sequelize.STRING(255),
                allowNull: true,
            },
            reporter_jira_id: {
                type: Sequelize.STRING(255),
                allowNull: true,
            },
            reporter_name: {
                type: Sequelize.STRING(255),
                allowNull: true,
            },
            story_points: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            was_completed: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            was_reopened: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            was_scope_change: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            cycle_time_hours: {
                type: Sequelize.FLOAT,
                allowNull: true,
            },
            time_in_qa_hours: {
                type: Sequelize.FLOAT,
                allowNull: true,
            },
            qa_tester_jira_id: {
                type: Sequelize.STRING(255),
                allowNull: true,
            },
            qa_tester_name: {
                type: Sequelize.STRING(255),
                allowNull: true,
            },
            bug_priority: {
                type: Sequelize.STRING(50),
                allowNull: true,
            },
            is_production_bug: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            synced_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });

        await queryInterface.addIndex('perf_ticket_facts', ['sync_id']);
        await queryInterface.addIndex('perf_ticket_facts', ['project_id', 'jira_key']);
        await queryInterface.addIndex('perf_ticket_facts', ['assignee_jira_id']);
        await queryInterface.addIndex('perf_ticket_facts', ['qa_tester_jira_id']);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('perf_ticket_facts');
    },
};
