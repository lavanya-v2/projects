'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.renameTable('weekly_reports', 'project_weekly_reports');
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.renameTable('project_weekly_reports', 'weekly_reports');
    }
};
