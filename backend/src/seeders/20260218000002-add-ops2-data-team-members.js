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
            "SELECT id, code FROM projects WHERE code IN ('AST', 'DATA') AND account_id = " + ccmhAccountId,
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        const projectMap = projects.reduce((acc, p) => {
            acc[p.code] = p.id;
            return acc;
        }, {});

        if (!projectMap['AST'] || !projectMap['DATA']) {
            console.warn('One or more projects (AST, DATA) not found. Skipping some assignments.');
        }

        // 3. Define Team Members
        const membersData = [
            // OPS 2 (AST)
            { projectCode: 'AST', first: 'Ganeshreddy', last: 'Kosuri', v2Email: 'ganeshreddy.kosuri@v2solutions.com', ccmEmail: 'Ganesh.Reddy_EXT@myccmortgage.com' },
            { projectCode: 'AST', first: 'Gargi', last: 'Sakhare', v2Email: 'gargi.sakhare@v2solutions.com', ccmEmail: 'Gargi.Sakhare_EXT@myccmortgage.com' },
            { projectCode: 'AST', first: 'Tarang', last: 'Ladumor', v2Email: 'tarang.ladumor@v2solutions.com', ccmEmail: 'Tarang.Ladumor@ccm.com' },
            { projectCode: 'AST', first: 'Vara Lakshmi', last: 'Koneti', v2Email: 'varalakshmi.koneti@v2solutions.com', ccmEmail: 'Varalakshmi.Koneti_EXT@myccmortgage.com' },
            { projectCode: 'AST', first: 'Vibha', last: 'Jalal', v2Email: 'vibha.jalal@v2solutions.com', ccmEmail: 'Vibha.Jalal_EXT@myccmortgage.com' },
            { projectCode: 'AST', first: 'Krunali', last: 'Chaudhari', v2Email: 'krunali.chaudhari@v2solutions.com', ccmEmail: 'kchaudhari_ext@myccmortgage.com' },

            // Data Engineering (DATA)
            { projectCode: 'DATA', first: 'Riya', last: 'Ramatri', v2Email: 'riya.ramatri@v2solutions.com', ccmEmail: 'Riya.Ramatri@ccm.com' },
            { projectCode: 'DATA', first: 'Rupesh', last: 'Singh', v2Email: 'rupesh.singh@v2solutions.com', ccmEmail: 'Rupesh.Singh@ccm.com' },
            { projectCode: 'DATA', first: 'Balbeer', last: 'Singh', v2Email: 'balbeer.singh@v2solutions.com', ccmEmail: 'Balbeer.Singh@ccm.com' },
            { projectCode: 'DATA', first: 'Ananthalaxmi', last: 'D', v2Email: 'ananthalaxmi.d@v2solutions.com', ccmEmail: 'Ananthalaxmi.D_EXT@ccm.com' },
            { projectCode: 'DATA', first: 'Aayush', last: 'Khattri', v2Email: 'aayush.khattri@v2solutions.com', ccmEmail: 'Aayush.Khattri@ccm.com' }
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
                await queryInterface.bulkInsert('team_members', [{
                    first_name: member.first,
                    last_name: member.last,
                    email: member.ccmEmail,
                    jira_login_id: member.ccmEmail,
                    partner_email_id: member.v2Email,
                    created_at: new Date(),
                    updated_at: new Date()
                }]);

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
        // Remove assignments for AST and DATA projects if needed
    }
};
