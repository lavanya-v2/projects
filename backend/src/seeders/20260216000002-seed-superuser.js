'use strict';
const bcrypt = require('bcrypt');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('V2CCMH@superUser', salt);

        // Insert superuser
        await queryInterface.bulkInsert('users', [{
            first_name: 'Super',
            last_name: 'User',
            user_id: 'superuser',
            password: hashedPassword,
            role: 'SUPERUSER',
            created_at: new Date(),
            updated_at: new Date()
        }]);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.bulkDelete('users', { user_id: 'superuser' }, {});
    }
};
