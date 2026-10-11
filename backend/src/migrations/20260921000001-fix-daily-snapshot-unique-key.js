'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // Bug: daily_board_snapshots was uniqued on (date, board_id). board_id is
        // Project.jiraBoardId, which changes when a project moves to a new Jira
        // board (e.g. a Scrum -> Kanban migration). Because the app's upsert
        // (reportService.ts saveSnapshot) relied on this same conflict key, a
        // regeneration for an already-snapshotted date AFTER a board switch could
        // never match the old row (different board_id) -- Postgres's ON CONFLICT
        // saw no match and silently INSERTED a duplicate instead of overwriting
        // it. One project (WO) already has real duplicate rows in production for
        // 2026-09-15/16/17 from exactly this sequence.
        //
        // Fix: re-key uniqueness on (date, project_id) -- the STABLE identity of
        // "whose report is this", unaffected by which Jira board that project
        // currently points at. Requires cleaning up the duplicates this bug
        // already created first, or the new unique index fails to create.

        // 1. Drop the old, wrong unique index.
        await queryInterface.removeIndex('daily_board_snapshots', 'daily_board_snapshots_date_board_id');

        // 2. Clean up existing duplicate (date, project_id) rows -- keep the
        // most recently generated row per pair (highest id), drop the rest.
        // Generic rule, not WO-specific: whichever version was generated last
        // is the one that reflects the project's current (correct) config.
        await queryInterface.sequelize.query(`
            DELETE FROM daily_board_snapshots a
            USING daily_board_snapshots b
            WHERE a.date = b.date
              AND a.project_id = b.project_id
              AND a.id < b.id
        `);

        // 3. Add the correct unique index.
        await queryInterface.addIndex('daily_board_snapshots', ['date', 'project_id'], {
            unique: true,
            name: 'daily_board_snapshots_date_project_id',
        });
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('daily_board_snapshots', 'daily_board_snapshots_date_project_id');
        await queryInterface.addIndex('daily_board_snapshots', ['date', 'board_id'], {
            unique: true,
            name: 'daily_board_snapshots_date_board_id',
        });
    },
};
