'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('account_weekly_reports');

    if (!tableInfo['key_accomplishments']) {
      await queryInterface.addColumn('account_weekly_reports', 'key_accomplishments', {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: []
      });
    }

    if (!tableInfo['red_projects']) {
      await queryInterface.addColumn('account_weekly_reports', 'red_projects', {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: []
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('account_weekly_reports');

    if (tableInfo['key_accomplishments']) {
      await queryInterface.removeColumn('account_weekly_reports', 'key_accomplishments');
    }
    if (tableInfo['red_projects']) {
      await queryInterface.removeColumn('account_weekly_reports', 'red_projects');
    }
  }
};
