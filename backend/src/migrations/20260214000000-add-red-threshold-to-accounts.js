
'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // Check if column exists first to be safe (optional but good practice)
        const tableInfo = await queryInterface.describeTable('accounts');
        if (!tableInfo.red_threshold_percentage) {
            await queryInterface.addColumn('accounts', 'red_threshold_percentage', {
                type: Sequelize.INTEGER,
                defaultValue: 30, // Default to 30%
                allowNull: false
            });
        }
    },

    down: async (queryInterface, Sequelize) => {
        // Reverting the change
        await queryInterface.removeColumn('accounts', 'red_threshold_percentage');
    }
};
