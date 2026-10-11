'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('risks', 'resolution', {
            type: Sequelize.TEXT,
            allowNull: true,
            defaultValue: null
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('risks', 'resolution');
    }
};
