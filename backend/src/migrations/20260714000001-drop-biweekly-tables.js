'use strict';

/**
 * Drops the Bi-Weekly Report feature tables. The feature code was removed and
 * no bi-weekly reports were ever created, so there is no data to preserve.
 *
 * FK-safe + idempotent via Postgres IF EXISTS / CASCADE:
 *   1. Sever the orphaned `sprints.biweekly_report_id` FK (→ biweekly_reports),
 *      which would otherwise block the drop. Its index drops with the column.
 *   2. Drop the junction tables (FK → biweekly_reports), then the parent table.
 *
 * The historical create-migrations remain in the tree for reference. The
 * orphaned `sprints` table itself (no model/code uses it) is intentionally left
 * in place — only its bi-weekly FK column is removed.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TABLE IF EXISTS "sprints" DROP COLUMN IF EXISTS "biweekly_report_id" CASCADE;'
    );
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS "biweekly_action_items" CASCADE;');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS "biweekly_perf_syncs" CASCADE;');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS "biweekly_reports" CASCADE;');
  },

  async down() {
    // Irreversible: the bi-weekly feature and its (empty) tables were removed
    // permanently. Restore from the historical create-migrations if ever needed.
  },
};
