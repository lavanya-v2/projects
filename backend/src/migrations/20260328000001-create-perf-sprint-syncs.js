'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('perf_sprint_syncs', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER,
            },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'projects', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            jira_sprint_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
            },
            sprint_name: {
                type: Sequelize.STRING(255),
                allowNull: false,
            },
            period_label: {
                type: Sequelize.STRING(255),
                allowNull: true,
            },
            start_date: {
                type: Sequelize.DATEONLY,
                allowNull: false,
            },
            end_date: {
                type: Sequelize.DATEONLY,
                allowNull: false,
            },
            sync_type: {
                type: Sequelize.STRING(20),
                allowNull: false,
                defaultValue: 'sprint',
            },
            sync_status: {
                type: Sequelize.STRING(20),
                allowNull: false,
                defaultValue: 'pending',
            },
            error_message: {
                type: Sequelize.TEXT,
                allowNull: true,
            },
            synced_at: {
                type: Sequelize.DATE,
                allowNull: true,
            },
            triggered_by_user_id: {
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

        await queryInterface.addIndex('perf_sprint_syncs', ['project_id']);
        await queryInterface.addIndex('perf_sprint_syncs', ['project_id', 'jira_sprint_id'], {
            unique: true,
            where: { jira_sprint_id: { [Sequelize.Op ? Sequelize.Op.ne : 'ne']: null } },
            name: 'perf_sprint_syncs_project_sprint_unique',
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('perf_sprint_syncs');
    },
};
