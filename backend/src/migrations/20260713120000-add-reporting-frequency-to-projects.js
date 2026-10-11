'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('projects', 'reporting_frequency', {
            type: Sequelize.STRING(20),
            allowNull: false,
            defaultValue: 'daily'
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('projects', 'reporting_frequency');
    }
};
