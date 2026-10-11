'use strict';

module.exports = {
    async up(queryInterface) {
        // Get all roles
        const roles = await queryInterface.sequelize.query(
            'SELECT id, name FROM roles',
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        const superuserRole = roles.find(r => r.name === 'superuser');
        const memberRole = roles.find(r => r.name === 'member');

        if (!superuserRole || !memberRole) {
            throw new Error('Required roles not found. Run seed-roles first.');
        }

        // Get all users
        const users = await queryInterface.sequelize.query(
            'SELECT id, user_id FROM users',
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (users.length === 0) return;

        // Build user_roles entries:
        // All users get 'member' role by default.
        // Admins can promote specific users to 'superuser' (or other roles) via User Management UI.
        // The 'superuser' login account is always treated as SUPERUSER via users.role ENUM in DB,
        // so its user_roles entry does not affect its access level.
        const userRoleEntries = users.map(user => ({
            user_id: user.id,
            role_id: memberRole.id,
            created_at: new Date(),
            updated_at: new Date()
        }));

        // Remove any existing user_roles to avoid duplicates on re-run
        await queryInterface.bulkDelete('user_roles', null, {});

        await queryInterface.bulkInsert('user_roles', userRoleEntries);
    },

    async down(queryInterface) {
        await queryInterface.bulkDelete('user_roles', null, {});
    }
};
