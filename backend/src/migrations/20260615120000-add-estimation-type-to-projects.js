'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('projects', 'estimation_type', {
            type: Sequelize.STRING(32),
            allowNull: false,
            defaultValue: 'story_points'
        });
        await queryInterface.addColumn('projects', 'hours_source', {
            type: Sequelize.STRING(32),
            allowNull: true
        });
        await queryInterface.addColumn('projects', 'hours_field_name', {
            type: Sequelize.STRING(255),
            allowNull: true
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('projects', 'hours_field_name');
        await queryInterface.removeColumn('projects', 'hours_source');
        await queryInterface.removeColumn('projects', 'estimation_type');
    }
};
