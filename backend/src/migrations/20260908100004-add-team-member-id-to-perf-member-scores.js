'use strict';

/**
 * Resolves perf_member_scores to a team member at write time.
 *
 * perf_member_scores.jira_login_id holds a Jira accountId; team_members.jira_login_id
 * holds an email-style login. They never match directly, so every consumer today
 * re-runs fuzzy name matching. This column resolves the identity once, through a
 * confirmed perf_identity_links row, and everything downstream joins on it.
 *
 * Deliberately nullable. A NULL is the visible signal "this score is unattributed"
 * — it drives the identity coverage gate and forces the review module to report
 * zero system coverage rather than silently dropping the person's delivery data
 * and handing them a default score.
 *
 * Backfill runs only from CONFIRMED links; `suggested` rows are not trusted here.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('perf_member_scores', 'team_member_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'team_members', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        });

        await queryInterface.sequelize.query(`
            UPDATE perf_member_scores pms
               SET team_member_id = pil.team_member_id
              FROM perf_identity_links pil
             WHERE pms.team_member_id IS NULL
               AND pil.project_id = pms.project_id
               AND pil.source     = 'jira'
               AND pil.status     = 'confirmed'
               AND pil.is_active  = true
               AND pil.source_key = pms.jira_login_id;
        `);

        await queryInterface.addIndex('perf_member_scores', ['team_member_id'], {
            name: 'perf_member_scores_team_member_idx'
        });
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('perf_member_scores', 'perf_member_scores_team_member_idx');
        await queryInterface.removeColumn('perf_member_scores', 'team_member_id');
    }
};
