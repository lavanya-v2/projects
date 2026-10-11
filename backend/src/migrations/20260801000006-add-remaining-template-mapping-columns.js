'use strict';

/**
 * Adds the five mapping columns the importer already reads but `template_mappings` could not store:
 * priority, status changed on, done date, parent and labels.
 *
 * Without `parent_ext_id` in particular, a project on a custom mapping could never point at its
 * Parent column, so Epic/Feature containers were indistinguishable from real work items and were
 * counted as tickets -- deflating ticket delivery and inflating "Unassigned".
 */

const COLUMNS = ['priority', 'status_changed_on', 'done_date', 'parent_ext_id', 'labels'];

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('template_mappings');

    for (const column of COLUMNS) {
      if (!table[column]) {
        await queryInterface.addColumn('template_mappings', column, {
          type: Sequelize.STRING,
          allowNull: true,
          defaultValue: null,
        });
      }
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('template_mappings');

    for (const column of COLUMNS) {
      if (table[column]) {
        await queryInterface.removeColumn('template_mappings', column);
      }
    }
  },
};
