'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('projects', 'default_daily_capacity_hours', {
            type: Sequelize.DECIMAL(5, 2),
            allowNull: true
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('projects', 'default_daily_capacity_hours');
    }
};
