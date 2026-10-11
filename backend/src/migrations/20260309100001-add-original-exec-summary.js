'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('daily_board_snapshots', 'original_executive_summary', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('project_weekly_reports', 'original_executive_summary', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('account_weekly_reports', 'original_executive_summary', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('daily_board_snapshots', 'original_executive_summary');
    await queryInterface.removeColumn('project_weekly_reports', 'original_executive_summary');
    await queryInterface.removeColumn('account_weekly_reports', 'original_executive_summary');
  },
};
