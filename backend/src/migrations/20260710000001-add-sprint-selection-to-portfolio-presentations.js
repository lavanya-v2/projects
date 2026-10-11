'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('portfolio_presentations', 'date_selection_mode', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'range',
    });
    await queryInterface.addColumn('portfolio_presentations', 'selected_sprint_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('portfolio_presentations', 'selected_sprint_id');
    await queryInterface.removeColumn('portfolio_presentations', 'date_selection_mode');
  },
};
