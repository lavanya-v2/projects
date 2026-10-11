'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // Add jira_email column
        await queryInterface.addColumn('projects', 'jira_email', {
            type: Sequelize.STRING(255),
            allowNull: true,
            field: 'jira_email'
        });

        // Add jira_api_token column
        await queryInterface.addColumn('projects', 'jira_api_token', {
            type: Sequelize.STRING(255),
            allowNull: true,
            field: 'jira_api_token'
        });
    },

    down: async (queryInterface, Sequelize) => {
        // Remove jira_api_token column
        await queryInterface.removeColumn('projects', 'jira_api_token');

        // Remove jira_email column
        await queryInterface.removeColumn('projects', 'jira_email');
    }
};
