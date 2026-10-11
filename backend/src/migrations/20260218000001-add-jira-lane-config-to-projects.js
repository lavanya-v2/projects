'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('projects', 'jira_lane_config', {
            type: Sequelize.JSONB,
            allowNull: true,
            defaultValue: null
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('projects', 'jira_lane_config');
    }
};
