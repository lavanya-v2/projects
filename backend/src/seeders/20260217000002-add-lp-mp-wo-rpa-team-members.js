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
            "SELECT id, code FROM projects WHERE code IN ('LP', 'MP', 'WO', 'CCMRPA') AND account_id = " + ccmhAccountId,
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        const projectMap = projects.reduce((acc, p) => {
            acc[p.code] = p.id;
            return acc;
        }, {});

        if (!projectMap['LP'] || !projectMap['MP'] || !projectMap['WO'] || !projectMap['CCMRPA']) {
            console.warn('One or more projects (LP, MP, WO, CCMRPA) not found. Skipping some assignments.');
        }

        // 3. Define Team Members
        const membersData = [
            // Loan Processes
            { projectCode: 'LP', first: 'Nirav', last: 'Parekh', v2Email: 'nirav.parekh@v2solutions.com', ccmEmail: 'nirav.parekh_ext@myccmortgage.com' },
            { projectCode: 'LP', first: 'Darshan', last: 'Soni', v2Email: 'darshan.soni@v2solutions.com', ccmEmail: 'Darshan.Soni@ccm.com' },
            { projectCode: 'LP', first: 'Archi', last: 'Patel', v2Email: 'archi.patel@v2solutions.com', ccmEmail: 'Archi.Patel_EXT@myccmortgage.com' },
            { projectCode: 'LP', first: 'Sushma', last: 'Jayaram', v2Email: 'sushma.jayaram@v2solutions.com', ccmEmail: 'Sushma.Jayaram_EXT@myccmortgage.com' },
            { projectCode: 'LP', first: 'Manjunath', last: 'G', v2Email: 'manjunath.g@v2solutions.com', ccmEmail: 'Manjunath.G_EXT@ccm.com' },
            { projectCode: 'LP', first: 'Nikhil', last: 'Sankar', v2Email: 'nikhil.sankar@v2solutions.com', ccmEmail: 'Nikhil.Sankar_EXT@myccmortgage.com' },
            { projectCode: 'LP', first: 'Vara Lakshmi', last: 'Koneti', v2Email: 'varalakshmi.koneti@v2solutions.com', ccmEmail: 'Varalakshmi.Koneti_EXT@myccmortgage.com' },

            // Marketplace
            { projectCode: 'MP', first: 'Pravin', last: 'Dongare', v2Email: 'pravin.dongare@V2solutions.com', ccmEmail: 'Pravin.Dongare_Ext@myccmortgage.com' },
            { projectCode: 'MP', first: 'Anisha', last: 'Babu', v2Email: 'anisha.babu@v2solutions.com', ccmEmail: 'Anisha.Babu_EXT@myccmortgage.com' },
            { projectCode: 'MP', first: 'Gaurav', last: 'Dhuri', v2Email: 'gaurav.dhuri@v2solutions.com', ccmEmail: 'Gaurav.Dhuri_EXT@myccmortgage.com' },
            { projectCode: 'MP', first: 'Soniya', last: 'Walve', v2Email: 'soniya.walve@V2solutions.com', ccmEmail: 'Soniya.Walve_EXT@myccmortgage.com' },
            { projectCode: 'MP', first: 'Jayant', last: 'Dharmadhikari', v2Email: 'jayant.d@V2solutions.com', ccmEmail: 'Jayant.Dharmadhikari_EXT@myccmortgage.com' },
            { projectCode: 'MP', first: 'Vara Lakshmi', last: 'Koneti', v2Email: 'varalakshmi.koneti@v2solutions.com', ccmEmail: 'Varalakshmi.Koneti_EXT@myccmortgage.com' },
            { projectCode: 'MP', first: 'Mahek', last: 'Purohit', v2Email: 'mahek.purohit@v2solutions.com', ccmEmail: 'Mahek.Purohit@ccm.com' },
            { projectCode: 'MP', first: 'Ansar', last: 'Saheb', v2Email: 'ansar.saheb@v2solutions.com', ccmEmail: 'Ansar.Saheb@ccm.com' },

            // WordPress
            { projectCode: 'WO', first: 'Sandeep', last: 'Anishetty', v2Email: 'sandeep.anishetty@v2solutions.com', ccmEmail: 'Sandeep.anishetty@ccm.com' },

            // RPA
            { projectCode: 'CCMRPA', first: 'Aaradhya', last: 'Tawade', v2Email: 'aaradhya.tawde@v2solutions.com', ccmEmail: 'Aaradhya.Tawde@ccm.com' },
            { projectCode: 'CCMRPA', first: 'Anjireddy', last: 'Pothireddy', v2Email: 'anjireddy.pothireddy@v2solutions.com', ccmEmail: 'Anjireddy.Pothireddy_EXT@myccmortgage.com' },
            { projectCode: 'CCMRPA', first: 'AshokKumar', last: 'Yenigala', v2Email: 'ashokkumar.y@v2solutions.com', ccmEmail: 'AshokKumar.Yenigala@ccm.com' },
            { projectCode: 'CCMRPA', first: 'Dipanjali', last: 'Mohanty', v2Email: 'dipanjali.mohanty@V2solutions.com', ccmEmail: 'Dipanjali.Mohanty@ccm.com' },
            { projectCode: 'CCMRPA', first: 'Dinesh', last: 'Jamdhade', v2Email: 'dinesh.jamdhade@v2solutions.com', ccmEmail: 'Dinesh.Jamdhade@ccm.com' },
            { projectCode: 'CCMRPA', first: 'Karunakar', last: 'Kasagani', v2Email: 'karunakar.kasagani@v2solutions.com', ccmEmail: 'Karunakar.Kasagani@ccm.com' },
            { projectCode: 'CCMRPA', first: 'Megh', last: 'Patel', v2Email: 'megh.patel@v2solutions.com', ccmEmail: 'Megh.Patel@ccm.com' },
            { projectCode: 'CCMRPA', first: 'Shreyansh', last: 'Hoshalkar', v2Email: 'shreyansh.hosalkar@v2solutions.com', ccmEmail: 'Shreyansh.Hosalkar@ccm.com' },
            { projectCode: 'CCMRPA', first: 'Swapnil', last: 'Dalvi', v2Email: 'swapnil.dalvi@v2solutions.com', ccmEmail: 'Swapnil.Dalvi_EXT@myccmortgage.com' },
            { projectCode: 'CCMRPA', first: 'Vishal', last: 'Bansode', v2Email: 'vishal.bansode@v2solutions.com', ccmEmail: 'Vishal.Bansode_EXT@myccmortgage.com' }
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

                // Get the inserted member ID
                const insertedMembers = await queryInterface.sequelize.query(
                    "SELECT id FROM team_members WHERE email = '" + member.ccmEmail + "'",
                    { type: queryInterface.sequelize.QueryTypes.SELECT }
                );
                memberId = insertedMembers[0].id;
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
        // For now, staying safe and manual intervention might be preferred.
    }
};
