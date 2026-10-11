'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.changeColumn('action_item_status_history', 'action_item_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.changeColumn('action_item_status_history', 'action_item_id', {
            type: Sequelize.INTEGER,
            allowNull: false,
        });
    },
};
