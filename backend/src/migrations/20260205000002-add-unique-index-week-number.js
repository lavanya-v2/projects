'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // Truncate table first to avoid unique constraint violations on existing rows with default values
        await queryInterface.bulkDelete('weekly_reports', null, {});

        await queryInterface.addIndex('weekly_reports', ['project_id', 'week_number', 'year'], {
            unique: true,
            name: 'unique_weekly_project_week_year'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeIndex('weekly_reports', 'unique_weekly_project_week_year');
    }
};
