'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // 1. Find the Account 'CCMH'
        const accounts = await queryInterface.sequelize.query(
            `SELECT id FROM accounts WHERE code = 'CCMH';`,
            { type: Sequelize.QueryTypes.SELECT }
        );

        if (!accounts || accounts.length === 0) {
            console.warn('Account CCMH not found. Skipping seed.');
            return;
        }
        const accountId = accounts[0].id;

        // 2. Find the Project 'SC'
        const projects = await queryInterface.sequelize.query(
            `SELECT id FROM projects WHERE code = 'SC' AND account_id = ${accountId};`,
            { type: Sequelize.QueryTypes.SELECT }
        );

        if (!projects || projects.length === 0) {
            console.warn('Project SC not found for account CCMH. Skipping seed.');
            return;
        }
        const projectId = projects[0].id;

        // 3. Prepare Team Members Data
        const emails = [
            'karan.haryani@ccm.com',
            'vamshikrishna.gadasu@ccm.com',
            'mahesh.sankaran_ext@myccmortgage.com',
            'shubham.bhalodiya@ccm.com',
            'dinesh.kumar_ext@ccm.com',
            'revati.more_ext@myccmortgage.com',
            'pravin.kambari_ext@myccmortgage.com'
        ];

        const newMembersData = emails.map(email => {
            // Extract name part before @
            const localPart = email.split('@')[0];
            // Remove _EXT or _ext (case insensitive)
            const namePart = localPart.replace(/_ext/i, '');
            // Split by dot to get First and Last names
            const parts = namePart.split('.');

            const firstName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
            // Some emails might not have a dot, or have more parts. 
            // Handle simple case: if 2 parts, second is last name. If 1, empty last name? 
            // Or better: everything after first part is last name.
            let lastName = '';
            if (parts.length > 1) {
                lastName = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
            }

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
                // If it doesn't exist, insert it
                // Note: bulkInsert returns logic varies by dialect. 
                // For safety in this environment, verification suggests we might need to query again or rely on returning: true working.
                const [result] = await queryInterface.bulkInsert('team_members', [member], { returning: true });
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
                console.log(`Assigned member ${memberId} to project SC`);
            } else {
                console.log(`Member ${memberId} already assigned to project SC`);
            }
        }
    },

    down: async (queryInterface, Sequelize) => {
        // Logic to revert if needed
        // For example, remove assignments for SC project
        // queryInterface.bulkDelete('account_team_members', { project_id: ... });
    }
};
