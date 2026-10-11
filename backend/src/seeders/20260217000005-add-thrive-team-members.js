'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // 1. Get Thrive Account ID
        const accounts = await queryInterface.sequelize.query(
            "SELECT id FROM accounts WHERE code = 'THRIVE'",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (!accounts || accounts.length === 0) {
            console.error('Thrive account not found. Skipping team member seeding.');
            return;
        }
        const thriveAccountId = accounts[0].id;

        // 2. Get PHX Project ID
        const projects = await queryInterface.sequelize.query(
            "SELECT id, code FROM projects WHERE code = 'PHX' AND account_id = " + thriveAccountId,
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (!projects || projects.length === 0) {
            console.warn('PHX project not found. Skipping team member seeding.');
            return;
        }

        const phxProjectId = projects[0].id;

        // 3. Define Team Members (using V2Solutions emails as both email and Jira login)
        const membersData = [
            { projectCode: 'PHX', first: 'Manoj', last: 'PM', v2Email: 'manoj.pm@v2solutions.com', jiraEmail: 'manoj.pm@v2solutions.com' },
            { projectCode: 'PHX', first: 'Amit', last: 'Rawal', v2Email: 'amit.rawal@v2solutions.com', jiraEmail: 'amit.rawal@v2solutions.com' },
            { projectCode: 'PHX', first: 'Anirudh', last: 'P', v2Email: 'anirudh.p@v2solutions.com', jiraEmail: 'anirudh.p@v2solutions.com' },
            { projectCode: 'PHX', first: 'Charly', last: 'Varghese', v2Email: 'charly.varghese@V2solutions.com', jiraEmail: 'charly.varghese@V2solutions.com' },
            { projectCode: 'PHX', first: 'Vinayak', last: 'Patil', v2Email: 'vinayak.patil@v2solutions.com', jiraEmail: 'vinayak.patil@v2solutions.com' },
            { projectCode: 'PHX', first: 'Manjeet', last: 'Kumar', v2Email: 'manjeet.kumar@v2solutions.com', jiraEmail: 'manjeet.kumar@v2solutions.com' },
            { projectCode: 'PHX', first: 'Divya', last: 'Pamnani', v2Email: 'divya.pamnani@v2solutions.com', jiraEmail: 'divya.pamnani@v2solutions.com' }
        ];

        // 4. Insert Team Members (upsert-ish)
        for (const member of membersData) {
            // Check if member exists by email
            const existingMembers = await queryInterface.sequelize.query(
                "SELECT id FROM team_members WHERE email = '" + member.jiraEmail + "'",
                { type: queryInterface.sequelize.QueryTypes.SELECT }
            );

            let memberId;
            if (existingMembers.length > 0) {
                memberId = existingMembers[0].id;
                console.log(`Member already exists: ${member.first} ${member.last}`);
            } else {
                await queryInterface.bulkInsert('team_members', [{
                    first_name: member.first,
                    last_name: member.last,
                    email: member.jiraEmail,
                    jira_login_id: member.jiraEmail,
                    partner_email_id: member.v2Email,
                    created_at: new Date(),
                    updated_at: new Date()
                }], { returning: true });

                // Get the inserted member ID
                const insertedMembers = await queryInterface.sequelize.query(
                    "SELECT id FROM team_members WHERE email = '" + member.jiraEmail + "'",
                    { type: queryInterface.sequelize.QueryTypes.SELECT }
                );
                memberId = insertedMembers[0].id;
                console.log(`Created member: ${member.first} ${member.last}`);
            }

            // 5. Assign to PHX Project
            if (phxProjectId && memberId) {
                const existingAssignment = await queryInterface.sequelize.query(
                    `SELECT id FROM account_team_members WHERE account_id = ${thriveAccountId} AND team_member_id = ${memberId} AND project_id = ${phxProjectId}`,
                    { type: queryInterface.sequelize.QueryTypes.SELECT }
                );

                if (existingAssignment.length === 0) {
                    await queryInterface.bulkInsert('account_team_members', [{
                        account_id: thriveAccountId,
                        team_member_id: memberId,
                        project_id: phxProjectId,
                        role: 'Developer',
                        created_at: new Date(),
                        updated_at: new Date()
                    }]);
                    console.log(`Assigned ${member.first} ${member.last} to PHX`);
                } else {
                    console.log(`Assignment already exists for ${member.first} ${member.last} in PHX`);
                }
            }
        }
    },

    down: async (queryInterface, Sequelize) => {
        // Logic to remove these specific assignments and members could be complex if they are shared.
        // For now, staying safe and manual intervention might be preferred.
    }
};
