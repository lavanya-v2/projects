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

        // 2. Define new CCMH projects
        const newProjects = [
            {
                name: 'Data Engineering',
                code: 'DATA',
                jira_board_id: 1102,
                jira_name: 'Data Engineering',
                jira_base_url: 'https://myccmortgage.atlassian.net',
                account_id: ccmhAccountId,
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'Marketplace',
                code: 'MP',
                jira_board_id: 97,
                jira_name: 'Marketplace',
                jira_base_url: 'https://myccmortgage.atlassian.net',
                account_id: ccmhAccountId,
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'Loan Processes',
                code: 'LP',
                jira_board_id: 262,
                jira_name: 'Loan Processes',
                jira_base_url: 'https://myccmortgage.atlassian.net',
                account_id: ccmhAccountId,
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'OPS 2',
                code: 'AST',
                jira_board_id: 1134,
                jira_name: 'OPS 2',
                jira_base_url: 'https://myccmortgage.atlassian.net',
                account_id: ccmhAccountId,
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'Workday',
                code: 'WD',
                jira_board_id: 245,
                jira_name: 'Workday',
                jira_base_url: 'https://myccmortgage.atlassian.net',
                account_id: ccmhAccountId,
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'RPA',
                code: 'CCMRPA',
                jira_board_id: 1267,
                jira_name: 'RPA',
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
            code: { [Sequelize.Op.in]: ['DATA', 'MP', 'LP', 'AST', 'WD', 'CCMRPA'] }
        });
    }
};
