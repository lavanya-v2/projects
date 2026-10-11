'use strict';

/**
 * Makes an import row self-describing:
 *
 *  - where the uploaded file is retained, how big it was, and its checksum (so a re-upload of an
 *    identical file can be recognised),
 *  - and a real failure record. `status` already declared pending/applied/rejected but was
 *    hardcoded to 'applied'; failures collapsed to a 500 with raw exception text and left no trace,
 *    so a user had no way to see that an import had failed at all.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async transaction => {
      const columns = {
        storage_path: { type: Sequelize.STRING(1024), allowNull: true },
        file_size: { type: Sequelize.INTEGER, allowNull: true },
        checksum: { type: Sequelize.STRING(64), allowNull: true },
        mime_type: { type: Sequelize.STRING(128), allowNull: true },
        error_message: { type: Sequelize.TEXT, allowNull: true },
        failed_at: { type: Sequelize.DATE, allowNull: true },
      };

      for (const [name, spec] of Object.entries(columns)) {
        await queryInterface.addColumn('excel_imports', name, spec, { transaction });
      }

      await queryInterface.addIndex('excel_imports', ['project_id', 'checksum'], {
        name: 'idx_excel_imports_project_checksum',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async transaction => {
      await queryInterface.removeIndex('excel_imports', 'idx_excel_imports_project_checksum', { transaction });

      for (const name of ['failed_at', 'error_message', 'mime_type', 'checksum', 'file_size', 'storage_path']) {
        await queryInterface.removeColumn('excel_imports', name, { transaction });
      }
    });
  },
};
