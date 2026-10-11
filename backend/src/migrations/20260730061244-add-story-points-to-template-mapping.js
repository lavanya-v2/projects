'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('template_mappings', 'story_points', {
      type: Sequelize.STRING(255),
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('template_mappings', 'story_points');
  },
};
