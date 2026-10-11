'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('biweekly_perf_syncs', {
            biweekly_report_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'biweekly_reports', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            perf_sync_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'perf_sprint_syncs', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            order_idx: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });

        await queryInterface.addConstraint('biweekly_perf_syncs', {
            fields: ['biweekly_report_id', 'perf_sync_id'],
            type: 'primary key',
            name: 'biweekly_perf_syncs_pkey',
        });

        await queryInterface.addIndex('biweekly_perf_syncs', ['perf_sync_id']);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('biweekly_perf_syncs');
    },
};
