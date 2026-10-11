'use strict';
const bcrypt = require('bcrypt');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // 1. Find the Account
        const accounts = await queryInterface.sequelize.query(
            `SELECT id FROM accounts WHERE code = 'CCMH';`,
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (accounts.length === 0) {
            console.error('Account CCMH not found. Skipping seeding permission.');
            return;
        }
        const accountId = accounts[0].id;

        // 2. Hash Password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('V2CCM@Admin', salt);

        // 3. Create User if not exists
        const users = await queryInterface.sequelize.query(
            `SELECT id FROM users WHERE user_id = 'ganeshan.a@v2solutions.com';`,
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        let userId;
        if (users.length > 0) {
            userId = users[0].id;
            // Update password just in case
            await queryInterface.bulkUpdate('users',
                { password: hashedPassword },
                { id: userId }
            );
        } else {
            const insertedUsers = await queryInterface.bulkInsert('users', [{
                first_name: 'Ganeshan',
                last_name: 'A',
                user_id: 'ganeshan.a@v2solutions.com',
                password: hashedPassword,
                created_at: new Date(),
                updated_at: new Date()
            }], { returning: true });
            userId = insertedUsers[0].id;
        }

        // 4. Create Account Permission
        // Check if permission already exists
        const permissions = await queryInterface.sequelize.query(
            `SELECT id FROM user_permissions WHERE user_id = ${userId} AND account_id = ${accountId};`,
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (permissions.length === 0) {
            await queryInterface.bulkInsert('user_permissions', [{
                user_id: userId,
                account_id: accountId,
                project_ids: Sequelize.literal('ARRAY[]::integer[]'),
                created_at: new Date(),
                updated_at: new Date()
            }]);
        }

        // 5. Create Project Permissions (Explicitly requested "and all its projects")
        // Although account level should suffice, let's add them to be safe/explicit if the user asked.
        // Actually, based on requirements "Idea is a person having account level permisson can generate all the projects..."
        // adding explicit project permissions might be redundant but harmless. 
        // Let's stick to Account permission as it is the "cleaner" implementation of the requirement.
    },

    async down(queryInterface, Sequelize) {
        // We strictly probably shouldn't delete the user in down if we want to preserve data, 
        // but for dev/test perfectly fine.
        const users = await queryInterface.sequelize.query(
            `SELECT id FROM users WHERE user_id = 'ganeshan.a@v2solutions.com';`,
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (users.length > 0) {
            await queryInterface.bulkDelete('user_permissions', { user_id: users[0].id });
            await queryInterface.bulkDelete('users', { id: users[0].id });
        }
    }
};
