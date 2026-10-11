'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // The day the reporting week starts on (0=Sun...6=Sat, JS Date.getDay() convention).
        // NOT NULL with a DEFAULT of 5 (Friday) -- Postgres backfills every existing row with
        // this default atomically as part of the ALTER TABLE, preserving today's hardcoded
        // Friday-Thursday cycle for every account until an admin explicitly changes it. No
        // separate seed step needed.
        await queryInterface.addColumn('accounts', 'week_start_day', {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 5,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('accounts', 'week_start_day');
    },
};
