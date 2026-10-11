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

        // 2. Define new projects
        const newProjects = [
            {
                name: 'WordPress',
                code: 'WO',
                jira_board_id: 211,
                jira_name: 'WordPress',
                jira_base_url: 'https://myccmortgage.atlassian.net',
                account_id: ccmhAccountId,
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'Prospecting',
                code: 'PRO',
                jira_board_id: 224,
                jira_name: 'Prospecting',
                jira_base_url: 'https://myccmortgage.atlassian.net',
                account_id: ccmhAccountId,
                created_at: new Date(),
                updated_at: new Date()
            }
        ];

        // 3. Insert projects if they don't exist
        for (const project of newProjects) {
            const existingProject = await queryInterface.sequelize.query(
                `SELECT id FROM projects WHERE code = '${project.code}'`,
                { type: queryInterface.sequelize.QueryTypes.SELECT }
            );

            if (existingProject.length === 0) {
                await queryInterface.bulkInsert('projects', [project]);
                console.log(`Created project: ${project.name} (${project.code})`);
            } else {
                console.log(`Project already exists: ${project.name} (${project.code})`);
            }
        }
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.bulkDelete('projects', {
            code: { [Sequelize.Op.in]: ['WO', 'PRO'] }
        });
    }
};
