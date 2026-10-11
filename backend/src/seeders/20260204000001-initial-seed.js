'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // 1. Seed Account
        const accounts = await queryInterface.bulkInsert('accounts', [{
            code: 'CCMH',
            name: 'CCMH',
            description: 'CCMH Account',
            created_at: new Date(),
            updated_at: new Date()
        }], { returning: true });

        const ccmhAccountId = accounts[0].id;

        // 2. Seed Projects
        const projectsData = [
            { name: 'LOSAI', code: 'LOSAI', jira_board_id: 98, jira_name: 'LOSAI', jira_base_url: 'https://myccmortgage.atlassian.net' },
            { name: 'LOWA', code: 'LOWA', jira_board_id: 197, jira_name: 'LOWA', jira_base_url: 'https://myccmortgage.atlassian.net' },
            { name: 'EXP', code: 'EXP', jira_board_id: 226, jira_name: 'EXP', jira_base_url: 'https://myccmortgage.atlassian.net' },
            { name: 'LOT', code: 'LOT', jira_board_id: 328, jira_name: 'LOT', jira_base_url: 'https://myccmortgage.atlassian.net' },
            { name: 'LS', code: 'LS', jira_board_id: 188, jira_name: 'LS', jira_base_url: 'https://myccmortgage.atlassian.net' }
        ];

        const projects = await queryInterface.bulkInsert('projects', projectsData.map(p => ({
            ...p,
            account_id: ccmhAccountId,
            created_at: new Date(),
            updated_at: new Date()
        })), { returning: true });

        // Map project codes to IDs for easy lookup
        const projectMap = projects.reduce((acc, p) => {
            acc[p.code] = p.id;
            return acc;
        }, {});

        // 3. Prepare Team Members Data
        const losaiMembers = [
            { email: 'Shubhangi.Pathare_EXT@myccmortgage.com', first: 'Shubhangi', last: 'Pathare' },
            { email: 'Apoorva.Joshi_EXT@ccm.com', first: 'Apoorva', last: 'Joshi' },
            { email: 'Ratheesh.R_EXT@myccmortgage.com', first: 'Ratheesh', last: 'R' },
            { email: 'Rohit.Surve_EXT@myccmortgage.com', first: 'Rohit', last: 'Surve' },
            { email: 'Varalakshmi.Koneti_EXT@myccmortgage.com', first: 'Varalakshmi', last: 'Koneti' },
            { email: 'Parth.Patel_EXT@myccmortgage.com', first: 'Parth', last: 'Patel' },
            { email: 'Sreekumar.Nair_EXT@myccmortgage.com', first: 'Sreekumar', last: 'Nair' }
        ];

        const lowaMembers = [
            { email: 'Harikrishna.Kanta_EXT@myccmortgage.com', first: 'Harikrishna', last: 'Kanta' },
            { email: 'Sweta.Das@ccm.com', first: 'Sweta', last: 'Das' },
            { email: 'Yash.Suthar@ccm.com', first: 'Yash', last: 'Suthar' },
            { email: 'Dinesh.Kumar_EXT@ccm.com', first: 'Dinesh', last: 'Kumar' },
            { email: 'Revati.More_EXT@myccmortgage.com', first: 'Revati', last: 'More' }
        ];

        // Combine all members
        const allMembers = [...losaiMembers, ...lowaMembers];

        // 4. Seed Team Members
        // Use ignoreDuplicates logic or just raw insert since table is empty
        const insertedMembers = await queryInterface.bulkInsert('team_members', allMembers.map(m => ({
            first_name: m.first,
            last_name: m.last,
            email: m.email,
            jira_login_id: m.email,
            partner_email_id: m.email,
            created_at: new Date(),
            updated_at: new Date()
        })), { returning: true });

        // Map email to Member ID
        const memberMap = insertedMembers.reduce((acc, m) => {
            acc[m.email] = m.id;
            return acc;
        }, {});

        // 5. Assign Members to Projects
        const assignments = [];

        // Assign LOSAI
        losaiMembers.forEach(m => {
            if (memberMap[m.email] && projectMap['LOSAI']) {
                assignments.push({
                    account_id: ccmhAccountId,
                    team_member_id: memberMap[m.email],
                    project_id: projectMap['LOSAI'],
                    role: 'Developer',
                    created_at: new Date(),
                    updated_at: new Date()
                });
            }
        });

        // Assign LOWA
        lowaMembers.forEach(m => {
            if (memberMap[m.email] && projectMap['LOWA']) {
                assignments.push({
                    account_id: ccmhAccountId,
                    team_member_id: memberMap[m.email],
                    project_id: projectMap['LOWA'],
                    role: 'Developer',
                    created_at: new Date(),
                    updated_at: new Date()
                });
            }
        });

        if (assignments.length > 0) {
            await queryInterface.bulkInsert('account_team_members', assignments);
        }
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.bulkDelete('account_team_members', null, {});
        await queryInterface.bulkDelete('team_members', null, {});
        await queryInterface.bulkDelete('projects', null, {});
        await queryInterface.bulkDelete('accounts', null, {});
    }
};
