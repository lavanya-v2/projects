'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('project_weekly_reports', 'weekly_health_rationale', {
            type: Sequelize.TEXT,
            allowNull: true,
            defaultValue: null
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('project_weekly_reports', 'weekly_health_rationale');
    }
};
