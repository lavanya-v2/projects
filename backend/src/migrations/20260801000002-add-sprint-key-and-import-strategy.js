'use strict';

/**
 * Groundwork for the ledger + projection model.
 *
 * excel_work_items stays an immutable per-import ledger (exactly what each file contained), but it
 * gains a normalised sprint_key so ticket identity can be expressed as (project, sprint, ext_id).
 * Without normalisation "Sprint 12", "sprint 12" and "Sprint 12 " are three different sprints.
 *
 * excel_imports gains the replay inputs: which conflict strategy the upload was applied with, and
 * which mapping version parsed it.
 */

// Keep in sync with sprintKey() in excelProjectionService.ts.
const SPRINT_KEY_SQL = `COALESCE(NULLIF(btrim(lower(sprint_name)), ''), '__no_sprint__')`;

module.exports = {
  async up(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async transaction => {
      await queryInterface.addColumn(
        'excel_work_items',
        'sprint_key',
        { type: Sequelize.STRING(255), allowNull: true },
        { transaction }
      );

      await sequelize.query(`UPDATE excel_work_items SET sprint_key = ${SPRINT_KEY_SQL}`, { transaction });

      await queryInterface.changeColumn(
        'excel_work_items',
        'sprint_key',
        { type: Sequelize.STRING(255), allowNull: false },
        { transaction }
      );

      await queryInterface.addIndex('excel_work_items', ['import_id', 'sprint_key', 'ext_id'], {
        name: 'idx_excel_work_items_import_sprint_ext',
        transaction,
      });

      await queryInterface.addColumn(
        'excel_imports',
        'conflict_strategy',
        { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'merge' },
        { transaction }
      );

      await queryInterface.addColumn(
        'excel_imports',
        'template_mapping_id',
        {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: 'template_mappings', key: 'id' },
          onDelete: 'SET NULL',
        },
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async transaction => {
      await queryInterface.removeColumn('excel_imports', 'template_mapping_id', { transaction });
      await queryInterface.removeColumn('excel_imports', 'conflict_strategy', { transaction });
      await queryInterface.removeIndex('excel_work_items', 'idx_excel_work_items_import_sprint_ext', {
        transaction,
      });
      await queryInterface.removeColumn('excel_work_items', 'sprint_key', { transaction });
    });
  },
};
