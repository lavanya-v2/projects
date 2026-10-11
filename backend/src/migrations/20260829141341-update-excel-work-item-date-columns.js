'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('excel_work_items', 'created_at_source', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.changeColumn('excel_work_items', 'updated_at_source', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.changeColumn('excel_ticket_state', 'created_at_source', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.changeColumn('excel_ticket_state', 'updated_at_source', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('excel_work_items', 'created_at_source', {
      type: Sequelize.DATE,
      allowNull: false,
    });

    await queryInterface.changeColumn('excel_work_items', 'updated_at_source', {
      type: Sequelize.DATE,
      allowNull: false,
    });

    await queryInterface.changeColumn('excel_ticket_state', 'created_at_source', {
      type: Sequelize.DATE,
      allowNull: false,
    });

    await queryInterface.changeColumn('excel_ticket_state', 'updated_at_source', {
      type: Sequelize.DATE,
      allowNull: false,
    });
  },
};
