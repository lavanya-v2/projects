'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // 1. Get CCMH Account ID
        const accounts = await queryInterface.sequelize.query(
            "SELECT id FROM accounts WHERE code = 'CCMH'",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (!accounts || accounts.length === 0) {
            console.error('CCMH account not found. Skipping team member addition.');
            return;
        }
        const ccmhAccountId = accounts[0].id;

        // 2. Get DB Project ID
        const projects = await queryInterface.sequelize.query(
            "SELECT id FROM projects WHERE code = 'DB' AND account_id = " + ccmhAccountId,
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (!projects || projects.length === 0) {
            console.error('DB project not found. Skipping team member addition.');
            return;
        }
        const dbProjectId = projects[0].id;

        // 3. Define Team Members to add/update
        const members = [
            {
                firstName: 'Manasa',
                lastName: 'Chingarapu',
                email: 'manasa.chingarapu@v2solutions.com',
                jiraLoginId: 'Manasa.Chingarapu@ccm.com',
                additionalProjects: ['PRO']
            },
            {
                firstName: 'Ananthalaxmi',
                lastName: 'D',
                email: 'ananthalaxmi.d@v2solutions.com',
                jiraLoginId: 'Ananthalaxmi.D_EXT@ccm.com',
                additionalProjects: ['DATA']
            }
        ];

        for (const member of members) {
            // Upsert team member
            const existingMember = await queryInterface.sequelize.query(
                `SELECT id FROM team_members WHERE email = '${member.email}'`,
                { type: queryInterface.sequelize.QueryTypes.SELECT }
            );

            let memberId;
            if (existingMember.length > 0) {
                memberId = existingMember[0].id;
                await queryInterface.sequelize.query(
                    `UPDATE team_members SET 
                        first_name = '${member.firstName}', 
                        last_name = '${member.lastName}', 
                        jira_login_id = '${member.jiraLoginId}', 
                        updated_at = NOW() 
                    WHERE id = ${memberId}`,
                    { type: queryInterface.sequelize.QueryTypes.UPDATE }
                );
                console.log(`Updated team member: ${member.firstName} ${member.lastName}`);
            } else {
                const [result] = await queryInterface.bulkInsert('team_members', [{
                    first_name: member.firstName,
                    last_name: member.lastName,
                    email: member.email,
                    jira_login_id: member.jiraLoginId,
                    created_at: new Date(),
                    updated_at: new Date()
                }], { returning: ['id'] });

                // If bulkInsert doesn't return ID in this environment, find it
                if (result && result.id) {
                    memberId = result.id;
                } else {
                    const newMember = await queryInterface.sequelize.query(
                        `SELECT id FROM team_members WHERE email = '${member.email}'`,
                        { type: queryInterface.sequelize.QueryTypes.SELECT }
                    );
                    memberId = newMember[0].id;
                }
                console.log(`Created team member: ${member.firstName} ${member.lastName}`);
            }

            // Link to project
            const existingLink = await queryInterface.sequelize.query(
                `SELECT id FROM account_team_members 
                 WHERE account_id = ${ccmhAccountId} 
                 AND team_member_id = ${memberId} 
                 AND project_id = ${dbProjectId}`,
                { type: queryInterface.sequelize.QueryTypes.SELECT }
            );

            if (existingLink.length === 0) {
                await queryInterface.bulkInsert('account_team_members', [{
                    account_id: ccmhAccountId,
                    team_member_id: memberId,
                    project_id: dbProjectId,
                    role: 'Database Engineer',
                    created_at: new Date(),
                    updated_at: new Date()
                }]);
                console.log(`Linked ${member.firstName} to Database project.`);
            } else {
                console.log(`${member.firstName} already linked to Database project.`);
            }

            // 4. Link to Additional Projects (Requirement Feb 27 Update)
            if (member.additionalProjects && member.additionalProjects.length > 0) {
                for (const projectCode of member.additionalProjects) {
                    const extraProjects = await queryInterface.sequelize.query(
                        `SELECT id FROM projects WHERE code = '${projectCode}' AND account_id = ${ccmhAccountId}`,
                        { type: queryInterface.sequelize.QueryTypes.SELECT }
                    );

                    if (extraProjects && extraProjects.length > 0) {
                        const projectId = extraProjects[0].id;
                        const existingExtraLink = await queryInterface.sequelize.query(
                            `SELECT id FROM account_team_members 
                             WHERE account_id = ${ccmhAccountId} 
                             AND team_member_id = ${memberId} 
                             AND project_id = ${projectId}`,
                            { type: queryInterface.sequelize.QueryTypes.SELECT }
                        );

                        if (existingExtraLink.length === 0) {
                            await queryInterface.bulkInsert('account_team_members', [{
                                account_id: ccmhAccountId,
                                team_member_id: memberId,
                                project_id: projectId,
                                role: 'Developer',
                                created_at: new Date(),
                                updated_at: new Date()
                            }]);
                            console.log(`Linked ${member.firstName} to ${projectCode} project.`);
                        } else {
                            console.log(`${member.firstName} already linked to ${projectCode} project.`);
                        }
                    } else {
                        console.warn(`Project with code ${projectCode} not found for account ${ccmhAccountId}.`);
                    }
                }
            }
        }
    },

    down: async (queryInterface, Sequelize) => {
        // Implementation for down not strictly necessary for this specific data seed
    }
};
