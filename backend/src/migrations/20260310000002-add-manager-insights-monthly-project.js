'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('monthly_project_reports', 'manager_insights', {
            type: Sequelize.TEXT,
            allowNull: true
        });
        await queryInterface.addColumn('monthly_project_reports', 'original_executive_summary', {
            type: Sequelize.TEXT,
            allowNull: true
        });
    },

    down: async (queryInterface) => {
        await queryInterface.removeColumn('monthly_project_reports', 'manager_insights');
        await queryInterface.removeColumn('monthly_project_reports', 'original_executive_summary');
    }
};
