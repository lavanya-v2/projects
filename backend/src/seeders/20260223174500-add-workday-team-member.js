'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // 1. Get CCMH Account ID
        const accounts = await queryInterface.sequelize.query(
            "SELECT id FROM accounts WHERE code = 'CCMH'",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (!accounts || accounts.length === 0) {
            console.error('CCMH account not found. Skipping team member seeding.');
            return;
        }
        const ccmhAccountId = accounts[0].id;

        // 2. Get Workday Project ID
        const projects = await queryInterface.sequelize.query(
            "SELECT id FROM projects WHERE code = 'WD' AND account_id = " + ccmhAccountId,
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (!projects || projects.length === 0) {
            console.warn('Workday project (WD) not found. Skipping assignment.');
            return;
        }
        const projectId = projects[0].id;

        // 3. Find Sandeep Anishetty by email (case-insensitive)
        const memberEmail = 'Sandeep.Anishetty@ccm.com';
        const members = await queryInterface.sequelize.query(
            "SELECT id FROM team_members WHERE email ILIKE '" + memberEmail + "'",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (!members || members.length === 0) {
            console.warn(`Team member with email ${memberEmail} not found. Skipping assignment.`);
            return;
        }
        const memberId = members[0].id;

        // 4. Assign to Project (Workday)
        const existingAssignment = await queryInterface.sequelize.query(
            `SELECT id FROM account_team_members WHERE account_id = ${ccmhAccountId} AND team_member_id = ${memberId} AND project_id = ${projectId}`,
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (existingAssignment.length === 0) {
            await queryInterface.bulkInsert('account_team_members', [{
                account_id: ccmhAccountId,
                team_member_id: memberId,
                project_id: projectId,
                role: 'Developer',
                created_at: new Date(),
                updated_at: new Date()
            }]);
            console.log(`Assigned Sandeep Anishetty to Workday project (WD)`);
        } else {
            console.log(`Assignment already exists for Sandeep Anishetty in Workday project (WD)`);
        }
    },

    down: async (queryInterface, Sequelize) => {
        // Find IDs to remove the specific assignment
        const accounts = await queryInterface.sequelize.query("SELECT id FROM accounts WHERE code = 'CCMH'", { type: queryInterface.sequelize.QueryTypes.SELECT });
        const projects = await queryInterface.sequelize.query("SELECT id FROM projects WHERE code = 'WD'", { type: queryInterface.sequelize.QueryTypes.SELECT });
        const members = await queryInterface.sequelize.query("SELECT id FROM team_members WHERE email = 'Sandeep.Anishetty@ccm.com'", { type: queryInterface.sequelize.QueryTypes.SELECT });

        if (accounts.length > 0 && projects.length > 0 && members.length > 0) {
            await queryInterface.bulkDelete('account_team_members', {
                account_id: accounts[0].id,
                project_id: projects[0].id,
                team_member_id: members[0].id
            });
            console.log('Removed Sandeep Anishetty from Workday project (WD)');
        }
    }
};
