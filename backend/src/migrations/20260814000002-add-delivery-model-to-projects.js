'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // Lands alongside is_kanban_project, not instead of it (see the Kanban
        // delivery-models design doc). Both stay readable and in agreement
        // until every call site has been converted to read delivery_model —
        // is_kanban_project is dropped only in a later migration once nothing
        // reads it. Default 'sprint' matches is_kanban_project's own default
        // of false, so a bare addColumn is already correct for every
        // non-Kanban project; only Kanban rows need the backfill UPDATE below.
        await queryInterface.addColumn('projects', 'delivery_model', {
            type: Sequelize.STRING(20),
            allowNull: false,
            defaultValue: 'sprint',
        });

        // Per-project opt-in: a cadence team that genuinely commits to a set of
        // work each cycle gets sprint-style commitment/spillover; one that
        // merely regroups gets N/A. Defaults off everywhere -- nothing is
        // reported as a commitment miss unless a project explicitly opts in.
        await queryInterface.addColumn('projects', 'tracks_commitment', {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        });

        // Backfill existing Kanban projects: cadence when a work-cycle is
        // configured, continuous otherwise. Sprint projects need no UPDATE --
        // the column default already put them at 'sprint'.
        await queryInterface.sequelize.query(`
            UPDATE projects
            SET delivery_model = CASE WHEN kanban_cycle_enabled THEN 'cadence' ELSE 'continuous' END
            WHERE is_kanban_project = true
        `);
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('projects', 'tracks_commitment');
        await queryInterface.removeColumn('projects', 'delivery_model');
    },
};
