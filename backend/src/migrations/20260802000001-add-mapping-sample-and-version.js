'use strict';

/**
 * Gives a column mapping a retained sample file, the header list it was built from, and a version.
 *
 * The sample workbook was previously parsed in the browser and thrown away, so a mapping could only
 * be edited by uploading the file again -- the header dropdowns had nothing to offer otherwise.
 * `source_headers` is what makes editing an existing mapping possible without re-uploading.
 *
 * Versioning already existed in behaviour (each save deactivates the previous row and repoints
 * projects.template_mapping_id); `version` and `superseded_at` make it legible so imports parsed
 * under an older mapping can be labelled as such.
 */

const COLUMNS = {
  storage_path: { type: 'STRING', length: 1024 },
  original_filename: { type: 'STRING', length: 512 },
  file_size: { type: 'INTEGER' },
  checksum: { type: 'STRING', length: 64 },
  mime_type: { type: 'STRING', length: 128 },
  source_headers: { type: 'JSONB' },
  version: { type: 'INTEGER' },
  superseded_at: { type: 'DATE' },
};

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('template_mappings');

    for (const [name, spec] of Object.entries(COLUMNS)) {
      if (table[name]) {
        continue;
      }

      const type =
        spec.type === 'JSONB'
          ? Sequelize.JSONB
          : spec.type === 'INTEGER'
            ? Sequelize.INTEGER
            : spec.type === 'DATE'
              ? Sequelize.DATE
              : Sequelize.STRING(spec.length);

      await queryInterface.addColumn('template_mappings', name, {
        type,
        allowNull: true,
        defaultValue: null,
      });
    }

    /*
     * Backfill version by creation order per project, so existing mappings read as v1, v2, ... and
     * an import's recorded mapping id can be shown as a version number rather than a row id.
     */
    await queryInterface.sequelize.query(`
      UPDATE template_mappings AS t
      SET version = ordered.rn
      FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn
        FROM template_mappings
      ) AS ordered
      WHERE t.id = ordered.id AND t.version IS NULL
    `);

    // Inactive rows were superseded at some point; the best available stamp is when the row that
    // replaced them was created. Approximated by the row's own updated_at, which the deactivation
    // wrote. Left null where the row is still active.
    await queryInterface.sequelize.query(`
      UPDATE template_mappings
      SET superseded_at = updated_at
      WHERE active = false AND superseded_at IS NULL
    `);
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('template_mappings');

    for (const name of Object.keys(COLUMNS)) {
      if (table[name]) {
        await queryInterface.removeColumn('template_mappings', name);
      }
    }
  },
};
