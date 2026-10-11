'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('daily_board_snapshots', 'sprint_burndown', {
            type: Sequelize.JSONB,
            allowNull: true,
            defaultValue: null
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('daily_board_snapshots', 'sprint_burndown');
    }
};
