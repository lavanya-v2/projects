'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('project_sprints', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      project_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'projects', key: 'id' },
        onDelete: 'CASCADE',
      },
      name: { type: Sequelize.STRING(255), allowNull: false },
      start_date: { type: Sequelize.DATEONLY, allowNull: true },
      end_date: { type: Sequelize.DATEONLY, allowNull: true },
      source: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'excel' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });

    await queryInterface.addIndex('project_sprints', ['project_id', 'name'], {
      name: 'uq_project_sprints_project_name',
      unique: true,
    });

    await queryInterface.addIndex('project_sprints', ['project_id', 'start_date', 'end_date'], {
      name: 'idx_project_sprints_project_dates',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('project_sprints');
  },
};
