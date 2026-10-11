'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('weekly_reports', 'week_number', {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0
        });

        await queryInterface.addColumn('weekly_reports', 'year', {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 2026
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('weekly_reports', 'week_number');
        await queryInterface.removeColumn('weekly_reports', 'year');
    }
};
