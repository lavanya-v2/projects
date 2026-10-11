'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('excel_imports', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      project_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'projects', key: 'id' },
        onDelete: 'CASCADE',
      },
      uploaded_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      template: { type: Sequelize.STRING(32), allowNull: false },
      mode: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'strict' },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'applied' },
      report_date: { type: Sequelize.DATEONLY, allowNull: true },
      period_start: { type: Sequelize.DATEONLY, allowNull: true },
      period_end: { type: Sequelize.DATEONLY, allowNull: true },
      row_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      history_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      has_history: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      validation_report: { type: Sequelize.JSONB, allowNull: true },
      original_filename: { type: Sequelize.STRING(512), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('excel_imports', ['project_id', 'created_at'], {
      name: 'idx_excel_imports_project_created',
    });

    await queryInterface.createTable('excel_work_items', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      import_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'excel_imports', key: 'id' },
        onDelete: 'CASCADE',
      },
      ext_id: { type: Sequelize.STRING(255), allowNull: false },
      title: { type: Sequelize.TEXT, allowNull: false },
      type: { type: Sequelize.STRING(64), allowNull: false },
      status: { type: Sequelize.STRING(128), allowNull: false },
      priority: { type: Sequelize.STRING(32), allowNull: true },
      assignee_email: { type: Sequelize.STRING(255), allowNull: false },
      story_points: { type: Sequelize.FLOAT, allowNull: true },
      sprint_name: { type: Sequelize.STRING(255), allowNull: true },
      sprint_start: { type: Sequelize.DATEONLY, allowNull: true },
      sprint_end: { type: Sequelize.DATEONLY, allowNull: true },
      created_at_source: { type: Sequelize.DATE, allowNull: false },
      updated_at_source: { type: Sequelize.DATE, allowNull: false },
      status_changed_on: { type: Sequelize.DATE, allowNull: true },
      done_date: { type: Sequelize.DATE, allowNull: true },
      parent_ext_id: { type: Sequelize.STRING(255), allowNull: true },
      labels: { type: Sequelize.ARRAY(Sequelize.TEXT), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('excel_work_items', ['import_id'], {
      name: 'idx_excel_work_items_import',
    });
    await queryInterface.addIndex('excel_work_items', ['import_id', 'ext_id'], {
      name: 'idx_excel_work_items_import_ext',
    });

    await queryInterface.createTable('excel_status_history', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      import_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'excel_imports', key: 'id' },
        onDelete: 'CASCADE',
      },
      ext_id: { type: Sequelize.STRING(255), allowNull: false },
      from_status: { type: Sequelize.STRING(128), allowNull: true },
      to_status: { type: Sequelize.STRING(128), allowNull: false },
      changed_on: { type: Sequelize.DATE, allowNull: false },
      changed_by_email: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('excel_status_history', ['import_id', 'ext_id'], {
      name: 'idx_excel_history_import_ext',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('excel_status_history');
    await queryInterface.dropTable('excel_work_items');
    await queryInterface.dropTable('excel_imports');
  },
};
