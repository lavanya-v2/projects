'use strict';

/**
 * Daily snapshots are keyed (date, board_id). Excel projects have no Jira board and the code used
 * `project.jiraBoardId || 0`, so EVERY Excel project shared board_id = 0 -- two of them reporting on
 * the same date silently overwrote each other. That is one of the three causes behind "files
 * uploaded for the same date get overwritten".
 *
 * The code now falls back to project.id. This re-keys the snapshots already stored under 0 so they
 * remain reachable. Rows that cannot be attributed to exactly one project are left alone rather
 * than guessed at -- they are reported by the SELECT in the log below.
 */

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    const { QueryTypes } = sequelize.constructor;

    const orphans = await sequelize.query(
      `SELECT count(*)::int AS count FROM daily_board_snapshots WHERE board_id = 0 AND project_id IS NULL`,
      { type: QueryTypes.SELECT }
    );

    if (orphans[0] && orphans[0].count > 0) {
      // Not fatal: these stay on board_id = 0 and remain readable, they just keep the old key.
      console.warn(
        `[rekey-excel-board-id-zero] ${orphans[0].count} snapshot(s) with board_id = 0 have no project_id and were left unchanged.`
      );
    }

    await sequelize.query(`
      UPDATE daily_board_snapshots s
      SET board_id = s.project_id
      WHERE s.board_id = 0
        AND s.project_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM daily_board_snapshots t
          WHERE t.date = s.date AND t.board_id = s.project_id
        )
    `);
  },

  async down() {
    // Deliberately not reversible: collapsing these back to board_id = 0 would recreate the
    // collision and lose whichever snapshot lost the race.
  },
};
