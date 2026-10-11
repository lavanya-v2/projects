module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'kanban_done_statuses', {
      type: Sequelize.ARRAY(Sequelize.TEXT),
      allowNull: true,
      defaultValue: null,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'kanban_done_statuses');
  },
};
