'use strict';

// Retires the legacy Sprint table. Prod has no presentation data yet, so we
// drop without migrating rows. The only inbound FK was Sprint.biweekly_report_id
// (Sprint → BiweeklyReport), which disappears with the table.

module.exports = {
    async up(queryInterface) {
        await queryInterface.dropTable('sprints');
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.createTable('sprints', {
            id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'projects', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            name: { type: Sequelize.STRING, allowNull: false },
            start_date: { type: Sequelize.DATEONLY, allowNull: false },
            end_date: { type: Sequelize.DATEONLY, allowNull: false },
            is_kanban_period: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
            metrics: { type: Sequelize.JSONB, allowNull: true, defaultValue: {} },
            goals: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            team_members: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            quality_metrics: { type: Sequelize.JSONB, allowNull: true, defaultValue: {} },
            ai_adoption_data: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            copilot_usage_stats: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
            biweekly_report_id: { type: Sequelize.INTEGER, allowNull: true },
            created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
            updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        });
    },
};
