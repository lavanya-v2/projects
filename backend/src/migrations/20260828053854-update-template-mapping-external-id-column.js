'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('template_mappings', 'external_id', {
      type: Sequelize.STRING(255),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface, Sequelize) {
    // Before reverting, make sure there are no NULL external_id values.
    await queryInterface.changeColumn('template_mappings', 'external_id', {
      type: Sequelize.STRING(255),
      allowNull: false,
    });
  },
};
