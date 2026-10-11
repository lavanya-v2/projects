'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('projects', 'program_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'programs', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
        });

        await queryInterface.addIndex('projects', ['program_id'], {
            name: 'projects_program_id_idx',
        });
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('projects', 'projects_program_id_idx');
        await queryInterface.removeColumn('projects', 'program_id');
    },
};
