'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('portfolio_presentations', 'custom_sections', {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: [],
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('portfolio_presentations', 'custom_sections');
    },
};
