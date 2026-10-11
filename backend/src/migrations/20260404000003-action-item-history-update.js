'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Make action_item_id nullable so account-level AIs can use this table
    await queryInterface.changeColumn('action_item_status_history', 'action_item_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'project_action_items', key: 'id' },
      onDelete: 'CASCADE',
    });

    // Add FK to account_action_items (nullable — exactly one of the two FKs will be set)
    await queryInterface.addColumn('action_item_status_history', 'account_action_item_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'account_action_items', key: 'id' },
      onDelete: 'CASCADE',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('action_item_status_history', 'account_action_item_id');

    // Restore NOT NULL — this is destructive if there are rows with null action_item_id
    await queryInterface.changeColumn('action_item_status_history', 'action_item_id', {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'project_action_items', key: 'id' },
      onDelete: 'CASCADE',
    });
  },
};
