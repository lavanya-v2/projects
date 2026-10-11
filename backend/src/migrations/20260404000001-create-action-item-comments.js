'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('action_item_comments', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      action_item_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'project_action_items', key: 'id' },
        onDelete: 'CASCADE',
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });

    await queryInterface.addIndex('action_item_comments', ['action_item_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('action_item_comments');
  },
};
