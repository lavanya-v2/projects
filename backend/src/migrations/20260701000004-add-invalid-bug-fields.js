'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('perf_ticket_facts', 'root_cause', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('perf_ticket_facts', 'invalid_bug', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('perf_member_scores', 'invalid_bugs_count', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('perf_member_scores', 'invalid_bugs_count');
    await queryInterface.removeColumn('perf_ticket_facts', 'invalid_bug');
    await queryInterface.removeColumn('perf_ticket_facts', 'root_cause');
  },
};
