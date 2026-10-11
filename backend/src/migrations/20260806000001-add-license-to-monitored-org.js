'use strict';

/**
 * Per-org license economics for the VALUE view (ADDENDUM 6). Both nullable —
 * when unset, the report falls back to the global benchmark in
 * config.collector (defaultLicenseType / defaultSeatMonthlyUsd) and labels the
 * figure as an assumption. Admins who know a customer's real seat cost set it here.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('monitored_org', 'license_type', {
            type: Sequelize.STRING(12), // 'seat' | 'api'
            allowNull: true,
        });
        await queryInterface.addColumn('monitored_org', 'seat_monthly_usd', {
            type: Sequelize.FLOAT,
            allowNull: true,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('monitored_org', 'seat_monthly_usd');
        await queryInterface.removeColumn('monitored_org', 'license_type');
    },
};
