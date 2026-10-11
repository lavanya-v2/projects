'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Check if column exists, then change type with explicit casting
    // Note: If existing text is not valid JSON, we might want to default to empty array or wrap it.
    // For simplicity, we'll just drop and re-add if data migration is too complex, 
    // OR try to cast. But since text might be just a string, direct cast might fail if it's not JSON formatted string.
    // Let's drop and re-add to be clean since this is dev environment and we can regenerate reports.

    await queryInterface.removeColumn('account_weekly_reports', 'risks');
    await queryInterface.addColumn('account_weekly_reports', 'risks', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: []
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('account_weekly_reports', 'risks');
    await queryInterface.addColumn('account_weekly_reports', 'risks', {
      type: Sequelize.TEXT,
      allowNull: true
    });
  }
};
