'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('daily_board_snapshots', 'data_quality_flags', {
            type: Sequelize.JSONB,
            allowNull: true,
            defaultValue: null
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('daily_board_snapshots', 'data_quality_flags');
    }
};
