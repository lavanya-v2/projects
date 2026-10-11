'use strict';

/**
 * The derived projection: current state of every ticket, merged across uploads.
 *
 * excel_work_items answers "what was in this file". excel_ticket_state answers "what is true now".
 * The unique index makes double-counting impossible at the database level -- previously nothing
 * prevented duplicate rows, and the application-level dedup that used to hide them was removed,
 * so a re-upload inflated every sprint scorecard number.
 *
 * The projection is fully derivable from the ledger, which is what makes delete, replace and
 * re-import reversible: rebuild by replaying imports in order.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;

    await queryInterface.createTable('excel_ticket_state', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      project_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'projects', key: 'id' },
        onDelete: 'CASCADE',
      },
      sprint_key: { type: Sequelize.STRING(255), allowNull: false },
      ext_id: { type: Sequelize.STRING(255), allowNull: false },
      last_import_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'excel_imports', key: 'id' },
        onDelete: 'SET NULL',
      },
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

    await queryInterface.addIndex('excel_ticket_state', ['project_id', 'sprint_key', 'ext_id'], {
      name: 'uq_excel_ticket_state_project_sprint_ext',
      unique: true,
    });
    await queryInterface.addIndex('excel_ticket_state', ['project_id', 'sprint_key'], {
      name: 'idx_excel_ticket_state_project_sprint',
    });

    /*
     * Backfill by replaying the existing ledger. Every pre-existing import is treated as 'merge',
     * so within each (project, sprint, ext_id) the newest import wins -- which reproduces the
     * newest-import-wins rule the code used before the dedup was removed, but scoped per sprint
     * rather than project-wide. Tickets that moved sprints therefore reappear in their historical
     * sprint instead of vanishing from it.
     */
    await sequelize.query(`
      INSERT INTO excel_ticket_state (
        project_id, sprint_key, ext_id, last_import_id,
        title, type, status, priority, assignee_email, story_points,
        sprint_name, sprint_start, sprint_end,
        created_at_source, updated_at_source, status_changed_on, done_date,
        parent_ext_id, labels, created_at, updated_at
      )
      SELECT DISTINCT ON (i.project_id, w.sprint_key, w.ext_id)
        i.project_id, w.sprint_key, w.ext_id, w.import_id,
        w.title, w.type, w.status, w.priority, w.assignee_email, w.story_points,
        w.sprint_name, w.sprint_start, w.sprint_end,
        w.created_at_source, w.updated_at_source, w.status_changed_on, w.done_date,
        w.parent_ext_id, w.labels, NOW(), NOW()
      FROM excel_work_items w
      JOIN excel_imports i ON i.id = w.import_id
      WHERE i.status = 'applied'
      ORDER BY i.project_id, w.sprint_key, w.ext_id, i.created_at DESC, w.id DESC
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('excel_ticket_state');
  },
};
