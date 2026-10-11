'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // Phase 3 of the RAG-reliability plan: monthly project status becomes deterministic
        // (rolled up from the month's weekly statuses) instead of written straight from the
        // AI. This column holds the human-readable rationale, mirroring weekly_health_rationale
        // on project_weekly_reports. Nullable, default null -- existing rows are unaffected
        // until the next monthly regeneration.
        await queryInterface.addColumn('monthly_project_reports', 'monthly_health_rationale', {
            type: Sequelize.TEXT,
            allowNull: true,
            defaultValue: null,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('monthly_project_reports', 'monthly_health_rationale');
    },
};
