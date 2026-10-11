'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('account_team_members', 'daily_capacity_hours', {
            type: Sequelize.DECIMAL(5, 2),
            allowNull: true
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('account_team_members', 'daily_capacity_hours');
    }
};
