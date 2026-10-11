'use strict';

/**
 * Adds the customer-facing 'executive' role. Executives get a locked-down,
 * read-only Executive Dashboard (project metrics + live sprint) scoped to the
 * projects granted via their UserPermission — and nothing else.
 *
 * Idempotent: inserts only if the row is missing, so it is safe to re-run and
 * does not disturb the original roles seeder.
 */
module.exports = {
    async up(queryInterface) {
        const [rows] = await queryInterface.sequelize.query(
            "SELECT 1 FROM roles WHERE name = 'executive' LIMIT 1"
        );
        if (rows.length > 0) return;
        await queryInterface.bulkInsert('roles', [
            {
                name: 'executive',
                description: 'Customer executive: read-only Executive Dashboard scoped to assigned projects',
                created_at: new Date(),
                updated_at: new Date()
            }
        ]);
    },

    async down(queryInterface) {
        await queryInterface.bulkDelete('roles', { name: 'executive' }, {});
    }
};
