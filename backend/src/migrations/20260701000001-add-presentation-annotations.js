'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('portfolio_presentations', 'graph_notes', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
    await queryInterface.addColumn('portfolio_presentations', 'velocity_capacity_flags', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('portfolio_presentations', 'velocity_capacity_flags');
    await queryInterface.removeColumn('portfolio_presentations', 'graph_notes');
  },
};
