'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // Per-project override of the Jira-priority-label -> severity-tier map used by the
        // daily production-bug health score (bugSeverityMath.ts). Nullable, default null, so
        // every existing project keeps using the built-in default map unless explicitly
        // configured otherwise -- no existing project's daily health calculation changes as
        // a result of this column existing.
        await queryInterface.addColumn('projects', 'bug_priority_map', {
            type: Sequelize.JSONB,
            allowNull: true,
            defaultValue: null,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('projects', 'bug_priority_map');
    },
};
