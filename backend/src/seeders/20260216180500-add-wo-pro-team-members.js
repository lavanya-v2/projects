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

        // 2. Get Project IDs
        const projects = await queryInterface.sequelize.query(
            "SELECT id, code FROM projects WHERE code IN ('WO', 'PRO') AND account_id = " + ccmhAccountId,
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        const projectMap = projects.reduce((acc, p) => {
            acc[p.code] = p.id;
            return acc;
        }, {});

        if (!projectMap['WO'] || !projectMap['PRO']) {
            console.warn('One or more projects (WO, PRO) not found. Skipping some assignments.');
        }

        // 3. Define Team Members
        const membersData = [
            // WordPress
            { projectCode: 'WO', first: 'Sakshee', last: 'Sharma', v2Email: 'sakshee.sharma@v2solutions.com', ccmEmail: 'Sakshee.Sharma_EXT@myccmortgage.com' },
            { projectCode: 'WO', first: 'Kanchan', last: 'Bahidar', v2Email: 'kanchan.bahidar@v2solutions.com', ccmEmail: 'Kanchan.Bahidar_EXT@myccmortgage.com' },
            { projectCode: 'WO', first: 'Sibi', last: 'Chakravarthy', v2Email: 'sibi.chakravarthy@v2solutions.com', ccmEmail: 'Sibi.Chakravarthy_EXT@myccmortgage.com' },
            { projectCode: 'WO', first: 'Shashikant', last: 'Chauhan', v2Email: 'shashikant.chauhan@v2solutions.com', ccmEmail: 'Shashikant.Chauhan@ccm.com' },
            { projectCode: 'WO', first: 'Pavneet', last: 'Saka', v2Email: 'pavneet.saka@v2solutions.com', ccmEmail: 'Pavneet.Saka_EXT@ccm.com' },
            { projectCode: 'WO', first: 'Priyanka', last: 'Patankar', v2Email: 'priyanka.patankar@v2solutions.com', ccmEmail: 'Priyanka.Patankar_EXT@myccmortgage.com' },
            // Prospecting
            { projectCode: 'PRO', first: 'Vidyadhar', last: 'Dighe', v2Email: 'vidyadhar.dighe@V2solutions.com', ccmEmail: 'Vidyadhar.Dighe_EXT@myccmortgage.com' },
            { projectCode: 'PRO', first: 'Virendra', last: 'Lad', v2Email: 'virendra.lad@V2solutions.com', ccmEmail: 'Virendra.Lad_EXT@myccmortgage.com' },
            { projectCode: 'PRO', first: 'Aditya', last: 'Joshi', v2Email: 'aditya.joshi@v2solutions.com', ccmEmail: 'Aditya.Joshi@ccm.com' },
            { projectCode: 'PRO', first: 'Jugal', last: 'Dave', v2Email: 'jugal.dave@v2solutions.com', ccmEmail: 'Jugal.Dave@ccm.com' },
            { projectCode: 'PRO', first: 'Sameer', last: 'Dev', v2Email: 'sameer.dev@v2solutions.com', ccmEmail: 'Sameer.Dev_EXT@myccmortgage.com' },
            { projectCode: 'PRO', first: 'Sunil', last: 'Kumar', v2Email: 'ssunil.kumar@v2solutions.com', ccmEmail: 'Sunil.Kumar_EXT@myccmortgage.com' },
            { projectCode: 'PRO', first: 'Manasa', last: 'Chirangapu', v2Email: 'manasa.chingarapu@v2solutions.com', ccmEmail: 'Manasa.Chingarapu@ccm.com' }
        ];

        // 4. Insert Team Members (upsert-ish)
        for (const member of membersData) {
            // Check if member exists by email
            const existingMembers = await queryInterface.sequelize.query(
                "SELECT id FROM team_members WHERE email = '" + member.ccmEmail + "'",
                { type: queryInterface.sequelize.QueryTypes.SELECT }
            );

            let memberId;
            if (existingMembers.length > 0) {
                memberId = existingMembers[0].id;
                console.log(`Member already exists: ${member.first} ${member.last}`);
            } else {
                const inserted = await queryInterface.bulkInsert('team_members', [{
                    first_name: member.first,
                    last_name: member.last,
                    email: member.ccmEmail,
                    jira_login_id: member.ccmEmail,
                    partner_email_id: member.v2Email,
                    created_at: new Date(),
                    updated_at: new Date()
                }], { returning: true });
                memberId = inserted[0].id;
                console.log(`Created member: ${member.first} ${member.last}`);
            }

            // 5. Assign to Project
            const projectId = projectMap[member.projectCode];
            if (projectId && memberId) {
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
                    console.log(`Assigned ${member.first} ${member.last} to ${member.projectCode}`);
                } else {
                    console.log(`Assignment already exists for ${member.first} ${member.last} in ${member.projectCode}`);
                }
            }
        }
    },

    down: async (queryInterface, Sequelize) => {
        // Logic to remove these specific assignments and members could be complex if they are shared.
        // For now, staying safe and manual intervention might be preferred or just delete carefully.
        // A simple revert might be to delete assignments for these projects.
    }
};
