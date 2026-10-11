'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // 1. Find the CCMH account
        const accounts = await queryInterface.sequelize.query(
            "SELECT id FROM accounts WHERE code = 'CCMH'",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (!accounts || accounts.length === 0) {
            console.error('CCMH account not found. Skipping project creation.');
            return;
        }

        const ccmhAccountId = accounts[0].id;

        // 2. Check if project already exists
        const existingProject = await queryInterface.sequelize.query(
            "SELECT id FROM projects WHERE code = 'DB'",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (existingProject.length > 0) {
            console.log('Project DB already exists. Updating is_shared_team flag...');
            await queryInterface.sequelize.query(
                `UPDATE projects SET is_shared_team = true, name = 'Database Engineering', jira_name = 'Database Engineering', jira_base_url = '', jira_api_token = '', jira_email = '', updated_at = NOW() WHERE code = 'DB'`,
                { type: queryInterface.sequelize.QueryTypes.UPDATE }
            );
            return;
        }

        // 3. Create Database Engineering project
        await queryInterface.bulkInsert('projects', [{
            name: 'Database Engineering',
            code: 'DB',
            jira_board_id: 0,
            jira_name: 'Database Engineering',
            jira_base_url: '',
            jira_api_token: '',
            jira_email: '',
            account_id: ccmhAccountId,
            is_shared_team: true,
            created_at: new Date(),
            updated_at: new Date()
        }]);

        console.log('Created project: Database Engineering (DB)');
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.bulkDelete('projects', {
            code: 'DB'
        });
    }
};
