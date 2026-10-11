'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('sprints', 'biweekly_report_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'biweekly_reports', key: 'id' },
            onDelete: 'SET NULL',
        });
        await queryInterface.addIndex('sprints', ['biweekly_report_id'], {
            name: 'sprints_biweekly_report_id_idx',
        });
    },

    down: async (queryInterface) => {
        await queryInterface.removeIndex('sprints', 'sprints_biweekly_report_id_idx');
        await queryInterface.removeColumn('sprints', 'biweekly_report_id');
    },
};
