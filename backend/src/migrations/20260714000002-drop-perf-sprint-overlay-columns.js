'use strict';

/**
 * Drops the unused human-entered overlay columns from perf_sprint_syncs. These
 * (`goals` + `member_overrides` JSONB) were written only by the removed Bi-Weekly
 * form and had no remaining readers or writers in the codebase.
 *
 * Reversible: `down` re-adds the columns with their original JSONB default.
 * Guarded with IF EXISTS so it is idempotent across environments.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE "perf_sprint_syncs" DROP COLUMN IF EXISTS "goals";');
    await queryInterface.sequelize.query('ALTER TABLE "perf_sprint_syncs" DROP COLUMN IF EXISTS "member_overrides";');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('perf_sprint_syncs', 'goals', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });
    await queryInterface.addColumn('perf_sprint_syncs', 'member_overrides', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });
  },
};
