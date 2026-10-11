'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add team_members to daily_board_snapshots
    await queryInterface.addColumn('daily_board_snapshots', 'team_members', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: []
    });

    // Add team_members and metrics to project_weekly_reports
    await queryInterface.addColumn('project_weekly_reports', 'team_members', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: []
    });

    await queryInterface.addColumn('project_weekly_reports', 'metrics', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: {}
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('daily_board_snapshots', 'team_members');
    await queryInterface.removeColumn('project_weekly_reports', 'team_members');
    await queryInterface.removeColumn('project_weekly_reports', 'metrics');
  }
};
