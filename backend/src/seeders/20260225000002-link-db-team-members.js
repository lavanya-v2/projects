'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // 1. Get CCMH Account ID
        const accounts = await queryInterface.sequelize.query(
            "SELECT id FROM accounts WHERE code = 'CCMH'",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (!accounts || accounts.length === 0) {
            console.error('CCMH account not found. Skipping team member linking.');
            return;
        }
        const ccmhAccountId = accounts[0].id;

        // 2. Get DB Project ID
        const projects = await queryInterface.sequelize.query(
            "SELECT id FROM projects WHERE code = 'DB' AND account_id = " + ccmhAccountId,
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (!projects || projects.length === 0) {
            console.error('DB project not found. Skipping team member linking.');
            return;
        }
        const dbProjectId = projects[0].id;

        // 3. Define Team Members to link
        const membersToLink = [
            { email: 'Dinesh.Kumar_EXT@ccm.com', first: 'Dinesh', last: 'Kumar' },
            { email: 'Varalakshmi.Koneti_EXT@myccmortgage.com', first: 'Varalakshmi', last: 'Koneti' }
        ];

        for (const member of membersToLink) {
            // Find member ID by email
            const teamMembers = await queryInterface.sequelize.query(
                `SELECT id FROM team_members WHERE email = '${member.email}'`,
                { type: queryInterface.sequelize.QueryTypes.SELECT }
            );

            if (!teamMembers || teamMembers.length === 0) {
                console.warn(`Team member with email ${member.email} not found. Skipping.`);
                continue;
            }

            const memberId = teamMembers[0].id;

            // Check if assignment already exists
            const existingAssignment = await queryInterface.sequelize.query(
                `SELECT id FROM account_team_members WHERE account_id = ${ccmhAccountId} AND team_member_id = ${memberId} AND project_id = ${dbProjectId}`,
                { type: queryInterface.sequelize.QueryTypes.SELECT }
            );

            if (existingAssignment.length === 0) {
                await queryInterface.bulkInsert('account_team_members', [{
                    account_id: ccmhAccountId,
                    team_member_id: memberId,
                    project_id: dbProjectId,
                    role: 'Database Engineer',
                    created_at: new Date(),
                    updated_at: new Date()
                }]);
                console.log(`Linked ${member.first} ${member.last} to DB project.`);
            } else {
                console.log(`${member.first} ${member.last} is already linked to DB project.`);
            }
        }
    },

    down: async (queryInterface, Sequelize) => {
        // Find DB Project ID
        const projects = await queryInterface.sequelize.query(
            "SELECT id FROM projects WHERE code = 'DB'",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (projects.length > 0) {
            const dbProjectId = projects[0].id;
            await queryInterface.bulkDelete('account_team_members', {
                project_id: dbProjectId
            });
        }
    }
};
