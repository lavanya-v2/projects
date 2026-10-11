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

        // Helper function to process members for a project
        const processProjectMembers = async (projectCode, emails) => {
            // Find Project
            const projects = await queryInterface.sequelize.query(
                `SELECT id FROM projects WHERE code = '${projectCode}' AND account_id = ${accountId};`,
                { type: Sequelize.QueryTypes.SELECT }
            );

            if (!projects || projects.length === 0) {
                console.warn(`Project ${projectCode} not found for account CCMH. Skipping seed for ${projectCode}.`);
                return;
            }
            const projectId = projects[0].id;

            const newMembersData = emails.map(email => {
                const localPart = email.split('@')[0];
                const namePart = localPart.replace(/_ext/i, '');
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

            const insertedMemberIds = [];

            for (const member of newMembersData) {
                const existing = await queryInterface.sequelize.query(
                    `SELECT id FROM team_members WHERE email = '${member.email}';`,
                    { type: Sequelize.QueryTypes.SELECT }
                );

                let memberId;
                if (existing.length === 0) {
                    const [result] = await queryInterface.bulkInsert('team_members', [member], { returning: true });
                    memberId = result.id;
                    console.log(`Inserted member: ${member.email}`);
                } else {
                    memberId = existing[0].id;
                    console.log(`Member already exists: ${member.email}`);
                }
                insertedMemberIds.push(memberId);
            }

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
                    console.log(`Assigned member ${memberId} to project ${projectCode}`);
                } else {
                    console.log(`Member ${memberId} already assigned to project ${projectCode}`);
                }
            }
        };

        // 2. Add Yogesh to LOT
        await processProjectMembers('LOT', ['yogesh.chande_ext@myccmortgage.com']);

        // 3. Add members to LS
        const lsEmails = [
            'janani.v_ext@myccmortgage.com',
            'Bhushan.Patil_EXT@myccmortgage.com',
            'Baban.tiwari_EXT@myccmortgage.com',
            'Nagaraj.K_EXT@myccmortgage.com',
            'Aditya.Bhoir_EXT@myccmortgage.com'
        ];
        await processProjectMembers('LS', lsEmails);
    },

    down: async (queryInterface, Sequelize) => {
        // 1. Find Account CCMH
        const accounts = await queryInterface.sequelize.query(
            `SELECT id FROM accounts WHERE name = 'CCMH';`,
            { type: Sequelize.QueryTypes.SELECT }
        );

        if (!accounts || accounts.length === 0) {
            return;
        }
        const accountId = accounts[0].id;

        // 2. Find Project IDs for LOT and LS
        const projects = await queryInterface.sequelize.query(
            `SELECT id FROM projects WHERE code IN ('LOT', 'LS') AND account_id = ${accountId};`,
            { type: Sequelize.QueryTypes.SELECT }
        );

        if (!projects || projects.length === 0) {
            return;
        }
        const projectIds = projects.map(p => p.id).join(',');

        // 3. Find Team Members associated with these projects
        const assignments = await queryInterface.sequelize.query(
            `SELECT team_member_id FROM account_team_members WHERE account_id = ${accountId} AND project_id IN (${projectIds});`,
            { type: Sequelize.QueryTypes.SELECT }
        );

        const memberIds = assignments.map(a => a.team_member_id);

        if (memberIds.length > 0) {
            const uniqueMemberIds = [...new Set(memberIds)];

            // 4. Delete assignments
            await queryInterface.sequelize.query(
                `DELETE FROM account_team_members WHERE account_id = ${accountId} AND project_id IN (${projectIds});`
            );

            // 5. Delete orphaned members
            for (const memberId of uniqueMemberIds) {
                const remaining = await queryInterface.sequelize.query(
                    `SELECT id FROM account_team_members WHERE team_member_id = ${memberId};`,
                    { type: Sequelize.QueryTypes.SELECT }
                );

                if (remaining.length === 0) {
                    await queryInterface.sequelize.query(
                        `DELETE FROM team_members WHERE id = ${memberId};`
                    );
                    console.log(`Deleted orphaned member ${memberId}`);
                }
            }
        }
    }
};
