'use strict';

module.exports = {
    async up(queryInterface) {
        await queryInterface.bulkInsert('roles', [
            {
                name: 'superuser',
                description: 'Full admin access to all modules including Risk Management',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'manager',
                description: 'Project manager level access',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'lead',
                description: 'Team lead level access',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'member',
                description: 'Regular team member access',
                created_at: new Date(),
                updated_at: new Date()
            }
        ]);
    },

    async down(queryInterface) {
        await queryInterface.bulkDelete('roles', null, {});
    }
};
