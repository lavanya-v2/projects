'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('perf_member_scores', 'sp_rework', {
      type: Sequelize.FLOAT,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('perf_member_scores', 'rework_factor', {
      type: Sequelize.FLOAT,
      allowNull: false,
      defaultValue: 0,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('perf_member_scores', 'sp_rework');
    await queryInterface.removeColumn('perf_member_scores', 'rework_factor');
  },
};
