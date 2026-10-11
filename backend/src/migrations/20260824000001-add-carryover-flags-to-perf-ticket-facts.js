'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('perf_ticket_facts', 'is_repeat_carryover', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('perf_ticket_facts', 'is_administrative_reassignment', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('perf_ticket_facts', 'is_administrative_reassignment');
    await queryInterface.removeColumn('perf_ticket_facts', 'is_repeat_carryover');
  },
};
