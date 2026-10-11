'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('daily_board_snapshots', 'updated_at', {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn('NOW')
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('daily_board_snapshots', 'updated_at');
    }
};
