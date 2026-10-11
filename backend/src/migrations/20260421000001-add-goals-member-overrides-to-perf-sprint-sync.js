'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('perf_sprint_syncs', 'goals', {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: [],
        });
        await queryInterface.addColumn('perf_sprint_syncs', 'member_overrides', {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: [],
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('perf_sprint_syncs', 'member_overrides');
        await queryInterface.removeColumn('perf_sprint_syncs', 'goals');
    },
};
