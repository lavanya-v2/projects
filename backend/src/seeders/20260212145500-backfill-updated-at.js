'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // SQL to update updated_at = created_at for all records
        await queryInterface.sequelize.query(
            'UPDATE daily_board_snapshots SET updated_at = created_at'
        );
    },

    down: async (queryInterface, Sequelize) => {
        // No operation needed for down usually, 
        // or maybe set it back to NOW? But that's destructive.
        // We can leave it empty or revert to default (which is what migration down would remove anyway).
    }
};
