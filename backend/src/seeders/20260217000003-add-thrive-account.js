'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // Check if Thrive account already exists
        const existingAccounts = await queryInterface.sequelize.query(
            "SELECT id FROM accounts WHERE code = 'THRIVE'",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (existingAccounts.length > 0) {
            console.log('Thrive account already exists. Skipping seed.');
            return;
        }

        // Seed Thrive Account
        await queryInterface.bulkInsert('accounts', [{
            code: 'THRIVE',
            name: 'Thrive',
            description: 'Thrive Account',
            created_at: new Date(),
            updated_at: new Date()
        }]);

        console.log('Created Thrive account successfully.');
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.bulkDelete('accounts', {
            code: 'THRIVE'
        });
    }
};
