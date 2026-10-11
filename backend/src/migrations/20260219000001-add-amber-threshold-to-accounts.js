'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        const tableInfo = await queryInterface.describeTable('accounts');
        if (!tableInfo.amber_threshold_percentage) {
            await queryInterface.addColumn('accounts', 'amber_threshold_percentage', {
                type: Sequelize.INTEGER,
                defaultValue: 20, // Default: >20% blocked WIP tickets → Amber
                allowNull: false
            });
        }
    },

    down: async (queryInterface) => {
        await queryInterface.removeColumn('accounts', 'amber_threshold_percentage');
    }
};
