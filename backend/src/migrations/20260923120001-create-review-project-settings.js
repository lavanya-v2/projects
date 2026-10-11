'use strict';

const TIMESTAMPS = (Sequelize) => ({
    created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
    },
    updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
    }
});

/**
 * Per-project overrides for Performance Review setup.
 *
 * Currently holds just a template pointer: "this project uses this competency
 * template" instead of the account-wide default. Deliberately a plain FK to an
 * existing template — not `competency_templates.scope='project'`, which means
 * "a template variant that only exists for this project" (authoring a new
 * thing). This is the opposite: picking an existing template out of the shared
 * library for one project, so a superuser is never forced to duplicate a
 * template just to point one project at it.
 *
 * One row per project by design (`project_id` unique) — this is a settings
 * table, not a history.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('review_project_settings', {
            id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                unique: true,
                references: { model: 'projects', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            template_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'competency_templates', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            ...TIMESTAMPS(Sequelize)
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('review_project_settings');
    }
};
