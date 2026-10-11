'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('risk_comments', 'edited_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('action_item_comments', 'edited_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('action_item_comments', 'edited_at');
    await queryInterface.removeColumn('risk_comments', 'edited_at');
  },
};
