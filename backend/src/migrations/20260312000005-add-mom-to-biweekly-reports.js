'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('biweekly_reports', 'meeting_transcript', {
            type: Sequelize.TEXT,
            allowNull: true,
        });
        await queryInterface.addColumn('biweekly_reports', 'mom_content', {
            type: Sequelize.TEXT,
            allowNull: true,
        });
        await queryInterface.addColumn('biweekly_reports', 'mom_generated_at', {
            type: Sequelize.DATE,
            allowNull: true,
        });
        await queryInterface.addColumn('biweekly_reports', 'mom_status', {
            type: Sequelize.STRING(20),
            allowNull: true,
        });
        await queryInterface.addColumn('biweekly_reports', 'locked_at', {
            type: Sequelize.DATE,
            allowNull: true,
        });
        await queryInterface.addColumn('biweekly_reports', 'locked_by_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' },
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('biweekly_reports', 'locked_by_id');
        await queryInterface.removeColumn('biweekly_reports', 'locked_at');
        await queryInterface.removeColumn('biweekly_reports', 'mom_status');
        await queryInterface.removeColumn('biweekly_reports', 'mom_generated_at');
        await queryInterface.removeColumn('biweekly_reports', 'mom_content');
        await queryInterface.removeColumn('biweekly_reports', 'meeting_transcript');
    },
};
