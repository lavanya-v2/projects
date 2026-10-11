'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('template_mappings', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      project_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'projects', key: 'id' },
        onDelete: 'CASCADE',
      },
      external_id: { type: Sequelize.STRING(255), allowNull: false },
      title: { type: Sequelize.STRING(255), allowNull: true, defaultValue: '' },
      type: { type: Sequelize.STRING(255), allowNull: true, defaultValue: '' },
      status: { type: Sequelize.STRING(255), allowNull: true, defaultValue: '' },
      sprint_name: { type: Sequelize.STRING(255), allowNull: true, defaultValue: '' },
      assignee_email: { type: Sequelize.STRING(255), allowNull: true, defaultValue: '' },
      created_date: { type: Sequelize.STRING(255), allowNull: true, defaultValue: '' },
      last_updated: { type: Sequelize.STRING(255), allowNull: true, defaultValue: '' },
      sprint_start_date: { type: Sequelize.STRING(255), allowNull: true, defaultValue: '' },
      sprint_end_date: { type: Sequelize.STRING(255), allowNull: true, defaultValue: '' },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('template_mappings');
  },
};
