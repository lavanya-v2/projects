'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // 1. Get the CCMH account ID
        const accounts = await queryInterface.sequelize.query(
            "SELECT id FROM accounts WHERE code = 'CCMH' LIMIT 1;",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (!accounts || accounts.length === 0) {
            console.error('Account CCMH not found. Cannot seed Project SC.');
            return;
        }

        const ccmhAccountId = accounts[0].id;

        // 2. Check if Project SC already exists
        const existingProject = await queryInterface.sequelize.query(
            "SELECT id FROM projects WHERE code = 'SC' LIMIT 1;",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (existingProject && existingProject.length > 0) {
            console.log('Project SC already exists. Skipping insertion.');
            return;
        }

        // 3. Insert Project SC
        await queryInterface.bulkInsert('projects', [{
            name: 'Secondary (LO ONE)',
            code: 'SC',
            jira_board_id: 606,
            jira_name: 'SC',
            jira_base_url: 'https://myccmortgage.atlassian.net',
            account_id: ccmhAccountId,
            created_at: new Date(),
            updated_at: new Date()
        }], {});
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.bulkDelete('projects', { code: 'SC' }, {});
    }
};
