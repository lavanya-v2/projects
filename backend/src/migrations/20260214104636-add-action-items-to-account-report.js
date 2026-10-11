'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDescription = await queryInterface.describeTable('account_weekly_reports');
    if (!tableDescription.action_items) {
      await queryInterface.addColumn('account_weekly_reports', 'action_items', {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: []
      });
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('account_weekly_reports', 'action_items');
  }
};
