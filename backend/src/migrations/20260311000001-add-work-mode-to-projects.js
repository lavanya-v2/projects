'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'work_mode', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'sprint',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'work_mode');
  },
};
