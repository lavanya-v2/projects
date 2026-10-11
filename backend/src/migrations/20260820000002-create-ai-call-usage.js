'use strict';

/**
 * Meter for this application's own Anthropic API spend.
 *
 * Every `messages.create` call returns a `usage` object and, until now, every one of
 * them was discarded — so the app's Claude bill could only ever be modelled, never
 * measured, and no cost optimisation could be shown to have worked. One row per call.
 *
 * Distinct from `claude_usage_daily`, which is Claude Code telemetry from engineers'
 * machines via the collector. This is the report generator's own consumption.
 *
 * Attribution columns are plain integers, not foreign keys: deleting a project should
 * neither cascade away its billing history nor be blocked by it, and the whole table
 * is meant to be droppable if the instrumentation is retired.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('ai_call_usage', {
            id: {
                type: Sequelize.BIGINT,
                primaryKey: true,
                autoIncrement: true,
                allowNull: false,
            },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
            call_site: {
                type: Sequelize.STRING(64),
                allowNull: false,
            },
            model: {
                type: Sequelize.STRING(100),
                allowNull: false,
            },
            input_tokens: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            output_tokens: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            cache_read_tokens: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            cache_creation_tokens: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
            },
            account_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
            },
            program_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
            },
            pricing_version_id: {
                type: Sequelize.BIGINT,
                allowNull: true,
            },
        });

        await queryInterface.addIndex('ai_call_usage', ['created_at'], {
            name: 'ai_call_usage_created_at_idx',
        });
        await queryInterface.addIndex('ai_call_usage', ['call_site'], {
            name: 'ai_call_usage_call_site_idx',
        });
        await queryInterface.addIndex('ai_call_usage', ['project_id'], {
            name: 'ai_call_usage_project_id_idx',
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('ai_call_usage');
    },
};
