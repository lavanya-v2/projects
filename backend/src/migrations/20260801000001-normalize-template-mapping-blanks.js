'use strict';

/**
 * Optional column-mapping fields defaulted to '' rather than NULL. The validator resolved a header
 * with `headerMap[key] ?? fallback`, and `??` does not fall back on the empty string -- so an
 * unmapped field resolved to the empty header, missed the header index and silently imported as
 * blank. For story points that surfaced as "SP is 0 even though Estimation - SP is mapped".
 *
 * The resolver now treats blank as "not configured", but the stored '' values are still misleading
 * (they read as "mapped to a column named nothing"). This normalises them to NULL and removes the
 * DEFAULT '' so new rows cannot reintroduce the ambiguity.
 *
 * Note story_points was added later WITHOUT a default, so pre-existing rows already hold NULL --
 * which is exactly why older projects kept working while newly-saved mappings broke.
 */

const OPTIONAL_COLUMNS = [
  'title',
  'type',
  'status',
  'sprint_name',
  'assignee_email',
  'created_date',
  'last_updated',
  'sprint_start_date',
  'sprint_end_date',
  'story_points',
];

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async transaction => {
      for (const column of OPTIONAL_COLUMNS) {
        await sequelize.query(`ALTER TABLE template_mappings ALTER COLUMN "${column}" DROP DEFAULT`, {
          transaction,
        });
        await sequelize.query(
          `UPDATE template_mappings SET "${column}" = NULL WHERE "${column}" IS NOT NULL AND btrim("${column}") = ''`,
          { transaction }
        );
      }
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async transaction => {
      for (const column of OPTIONAL_COLUMNS) {
        // story_points never had a default; restoring one would not be a faithful rollback.
        if (column === 'story_points') {
          continue;
        }

        await sequelize.query(`UPDATE template_mappings SET "${column}" = '' WHERE "${column}" IS NULL`, {
          transaction,
        });
        await sequelize.query(`ALTER TABLE template_mappings ALTER COLUMN "${column}" SET DEFAULT ''`, {
          transaction,
        });
      }
    });
  },
};
