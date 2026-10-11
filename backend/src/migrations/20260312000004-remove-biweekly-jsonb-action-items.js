'use strict';

module.exports = {
    async up(queryInterface) {
        await queryInterface.removeColumn('biweekly_reports', 'action_items');
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.addColumn('biweekly_reports', 'action_items', {
            type: Sequelize.JSONB,
            allowNull: true,
            defaultValue: [],
        });
    },
};
