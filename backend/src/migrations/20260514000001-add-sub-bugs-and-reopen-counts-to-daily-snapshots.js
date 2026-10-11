'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('daily_board_snapshots', 'sub_bugs_logged_count', {
            type: Sequelize.INTEGER,
            allowNull: true,
            defaultValue: null,
        });
        await queryInterface.addColumn('daily_board_snapshots', 'reopened_tickets_count', {
            type: Sequelize.INTEGER,
            allowNull: true,
            defaultValue: null,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('daily_board_snapshots', 'reopened_tickets_count');
        await queryInterface.removeColumn('daily_board_snapshots', 'sub_bugs_logged_count');
    },
};
