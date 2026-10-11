'use strict';

/**
 * ADDENDUM 22 — fleet-wide minimum collector version, enforced at ingest. A
 * single mutable settings row, seeded with no enforcement (both columns null)
 * so shipping this migration changes nothing until an admin explicitly sets a
 * policy from the "Ingest Rate Limit" admin tab.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('collector_version_policy', {
            id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
            min_enforced_version: { type: Sequelize.STRING, allowNull: true },
            enforce_after: { type: Sequelize.DATE, allowNull: true },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        });
        await queryInterface.bulkInsert('collector_version_policy', [
            { min_enforced_version: null, enforce_after: null, updated_at: new Date() },
        ]);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('collector_version_policy');
    },
};
