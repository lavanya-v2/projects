'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('daily_board_snapshots', 'confirmed_prod_bug_keys', {
            type: Sequelize.JSONB,
            allowNull: true,
            defaultValue: null
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('daily_board_snapshots', 'confirmed_prod_bug_keys');
    }
};
