'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('daily_board_snapshots', 'insights_health', {
      type: Sequelize.STRING(50),
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('daily_board_snapshots', 'insights_health_reason', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('daily_board_snapshots', 'insights_health');
    await queryInterface.removeColumn('daily_board_snapshots', 'insights_health_reason');
  },
};
