'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('monthly_account_reports', 'annexure', {
            type: Sequelize.JSONB,
            allowNull: true,
            defaultValue: []
        });
    },

    down: async (queryInterface) => {
        await queryInterface.removeColumn('monthly_account_reports', 'annexure');
    }
};
