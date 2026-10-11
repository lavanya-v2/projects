'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('user_permissions', 'program_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'programs', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
        });

        await queryInterface.addColumn('user_permissions', 'is_primary', {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        });

        await queryInterface.addIndex('user_permissions', ['program_id'], {
            name: 'user_permissions_program_id_idx',
        });
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('user_permissions', 'user_permissions_program_id_idx');
        await queryInterface.removeColumn('user_permissions', 'is_primary');
        await queryInterface.removeColumn('user_permissions', 'program_id');
    },
};
