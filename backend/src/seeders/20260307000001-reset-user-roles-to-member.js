'use strict';

/**
 * Resets all user_roles entries so every user defaults to the 'member' role.
 * Admins can then promote specific users to 'superuser' (Risk Management access)
 * or other roles via the User Management UI.
 *
 * Note: The 'superuser' login account is always treated as SUPERUSER via the
 * users.role ENUM column in the DB, so its user_roles entry has no effect on access.
 */
module.exports = {
    async up(queryInterface) {
        const roles = await queryInterface.sequelize.query(
            'SELECT id, name FROM roles',
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        const memberRole = roles.find(r => r.name === 'member');
        if (!memberRole) {
            throw new Error('member role not found. Run seed-roles first.');
        }

        const users = await queryInterface.sequelize.query(
            'SELECT id FROM users',
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (users.length === 0) return;

        // Wipe and re-seed all user_roles with 'member' as the default
        await queryInterface.bulkDelete('user_roles', null, {});

        await queryInterface.bulkInsert('user_roles', users.map(user => ({
            user_id: user.id,
            role_id: memberRole.id,
            created_at: new Date(),
            updated_at: new Date()
        })));
    },

    async down(queryInterface) {
        await queryInterface.bulkDelete('user_roles', null, {});
    }
};
