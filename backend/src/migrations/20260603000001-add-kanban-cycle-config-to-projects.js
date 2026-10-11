'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('projects', 'kanban_cycle_enabled', {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false
        });
        await queryInterface.addColumn('projects', 'kanban_cycle_days', {
            type: Sequelize.INTEGER,
            allowNull: true
        });
        await queryInterface.addColumn('projects', 'kanban_cycle_anchor_date', {
            type: Sequelize.DATEONLY,
            allowNull: true
        });
        await queryInterface.addColumn('projects', 'kanban_auto_sync', {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('projects', 'kanban_auto_sync');
        await queryInterface.removeColumn('projects', 'kanban_cycle_anchor_date');
        await queryInterface.removeColumn('projects', 'kanban_cycle_days');
        await queryInterface.removeColumn('projects', 'kanban_cycle_enabled');
    }
};
