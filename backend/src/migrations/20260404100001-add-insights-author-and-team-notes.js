'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = [
      'daily_board_snapshots',
      'project_weekly_reports',
      'account_weekly_reports',
      'monthly_project_reports',
      'monthly_account_reports',
    ];

    for (const table of tables) {
      await queryInterface.addColumn(table, 'insights_author_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      });

      await queryInterface.addColumn(table, 'insights_author_name', {
        type: Sequelize.STRING(200),
        allowNull: true,
      });

      await queryInterface.addColumn(table, 'team_notes', {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
      });
    }
  },

  async down(queryInterface) {
    const tables = [
      'daily_board_snapshots',
      'project_weekly_reports',
      'account_weekly_reports',
      'monthly_project_reports',
      'monthly_account_reports',
    ];

    for (const table of tables) {
      await queryInterface.removeColumn(table, 'insights_author_id');
      await queryInterface.removeColumn(table, 'insights_author_name');
      await queryInterface.removeColumn(table, 'team_notes');
    }
  },
};
