'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // 1. Find the Account 'CCMH'
        const accounts = await queryInterface.sequelize.query(
            `SELECT id FROM accounts WHERE name = 'CCMH';`,
            { type: Sequelize.QueryTypes.SELECT }
        );

        if (!accounts || accounts.length === 0) {
            console.warn('Account CCMH not found. Skipping seed.');
            return;
        }
        const accountId = accounts[0].id;

        // 2. Find the Project 'EXP'
        const projects = await queryInterface.sequelize.query(
            `SELECT id FROM projects WHERE code = 'EXP' AND account_id = ${accountId};`,
            { type: Sequelize.QueryTypes.SELECT }
        );

        if (!projects || projects.length === 0) {
            console.warn('Project EXP not found for account CCMH. Skipping seed.');
            return;
        }
        const projectId = projects[0].id;

        // 3. Prepare Team Members Data
        const emails = [
            'dhrupal.amin@myccmortgage.com',
            'namaskar.shah@myccmortgage.com',
            'Rinkuben.Shiyani_EXT@myccmortgage.com',
            'peyush.k_ext@myccmortgage.com',
            'Vinosh.Devasani_EXT@myccmortgage.com',
            'Dinesh.Kumar_EXT@ccm.com',
            'vishal.laghate_ext@myccmortgage.com'
        ];

        const newMembersData = emails.map(email => {
            // Extract name part before @
            const localPart = email.split('@')[0];
            // Remove _EXT or _ext (case insensitive)
            const namePart = localPart.replace(/_ext/i, '');
            // Split by dot to get First and Last names
            const parts = namePart.split('.');

            const firstName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
            const lastName = parts.length > 1 ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1) : '';

            return {
                first_name: firstName,
                last_name: lastName,
                email: email,
                jira_login_id: email,
                partner_email_id: email,
                created_at: new Date(),
                updated_at: new Date()
            };
        });

        // 4. Insert Team Members (if they don't exist)
        const insertedMemberIds = [];

        for (const member of newMembersData) {
            const existing = await queryInterface.sequelize.query(
                `SELECT id FROM team_members WHERE email = '${member.email}';`,
                { type: Sequelize.QueryTypes.SELECT }
            );

            let memberId;
            if (existing.length === 0) {
                const [result] = await queryInterface.bulkInsert('team_members', [member], { returning: true });
                // Sequelize bulkInsert with returning can behave differently across versions/dialects. 
                // result might be the object or ID depending on postgres/driver.
                // Assuming postgres returns the object.
                memberId = result.id;
                console.log(`Inserted member: ${member.email}`);
            } else {
                memberId = existing[0].id;
                console.log(`Member already exists: ${member.email}`);
            }
            insertedMemberIds.push(memberId);
        }

        // 5. Assign Members to Project (if not already assigned)
        for (const memberId of insertedMemberIds) {
            const existingAssignment = await queryInterface.sequelize.query(
                `SELECT id FROM account_team_members WHERE team_member_id = ${memberId} AND project_id = ${projectId} AND account_id = ${accountId};`,
                { type: Sequelize.QueryTypes.SELECT }
            );

            if (existingAssignment.length === 0) {
                await queryInterface.bulkInsert('account_team_members', [{
                    account_id: accountId,
                    team_member_id: memberId,
                    project_id: projectId,
                    role: 'Developer',
                    created_at: new Date(),
                    updated_at: new Date()
                }]);
                console.log(`Assigned member ${memberId} to project EXP`);
            } else {
                console.log(`Member ${memberId} already assigned to project EXP`);
            }
        }
    },

    down: async (queryInterface, Sequelize) => {
        // Logic to revert if needed, e.g., remove assignments for EXP project
    }
};
