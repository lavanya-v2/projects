'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('risks', 'ai_summary', {
            type: Sequelize.TEXT,
            allowNull: true,
            defaultValue: null,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('risks', 'ai_summary');
    },
};
