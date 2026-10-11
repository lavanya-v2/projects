'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // 1. Find the Thrive account
        const accounts = await queryInterface.sequelize.query(
            "SELECT id FROM accounts WHERE code = 'THRIVE'",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (!accounts || accounts.length === 0) {
            console.error('Thrive account not found. Skipping project creation.');
            return;
        }

        const thriveAccountId = accounts[0].id;

        // 2. Check if project already exists
        const existingProject = await queryInterface.sequelize.query(
            "SELECT id FROM projects WHERE code = 'PHX'",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (existingProject.length > 0) {
            console.log('Project PHX already exists. Skipping.');
            return;
        }

        // 3. Create Thrive project
        await queryInterface.bulkInsert('projects', [{
            name: 'Thrive',
            code: 'PHX',
            jira_board_id: 107,
            jira_name: 'Thrive',
            jira_base_url: 'https://thrivetrm.atlassian.net',
            account_id: thriveAccountId,
            created_at: new Date(),
            updated_at: new Date()
        }]);

        console.log('Created project: Thrive (PHX)');
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.bulkDelete('projects', {
            code: 'PHX'
        });
    }
};
