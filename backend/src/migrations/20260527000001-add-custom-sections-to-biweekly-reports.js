'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('biweekly_reports', 'custom_sections', {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: [],
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('biweekly_reports', 'custom_sections');
    },
};
