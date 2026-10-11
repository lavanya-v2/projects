'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // Red-count floor: escalates the account/program overall rollup to Red once this many
        // Red projects are present, regardless of percentage (fixes dilution in large accounts,
        // e.g. 2 Red + 13 Green never crossing a percentage threshold). Default 2 for every
        // existing account -- matches the agreed default, so no existing computed color changes
        // unless an account's real Red count was already >= 2 for a given period.
        await queryInterface.addColumn('accounts', 'red_project_count_floor', {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 2,
        });

        // Optional bad-percentage ceiling: when set, Red+Amber% crossing it escalates to Red
        // even with zero actual Red projects. Nullable, default null (disabled) -- every
        // existing account keeps today's behavior (pure-Amber saturation caps at Amber) unless
        // explicitly opted in.
        await queryInterface.addColumn('accounts', 'red_ceiling_bad_percentage', {
            type: Sequelize.INTEGER,
            allowNull: true,
            defaultValue: null,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('accounts', 'red_ceiling_bad_percentage');
        await queryInterface.removeColumn('accounts', 'red_project_count_floor');
    },
};
