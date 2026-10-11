'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('daily_board_snapshots', 'health_rationale', {
            type: Sequelize.TEXT,
            allowNull: true,
            defaultValue: null
        });
        await queryInterface.addColumn('daily_board_snapshots', 'ticket_details', {
            type: Sequelize.TEXT,
            allowNull: true,
            defaultValue: null
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('daily_board_snapshots', 'ticket_details');
        await queryInterface.removeColumn('daily_board_snapshots', 'health_rationale');
    }
};
