'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('perf_member_scores', 'sub_bugs_raised_count', {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
        });

        // Backfill from PerfTicketFact: count facts whose issue_type contains 'bug'
        // but is not exactly 'bug' (i.e. Sub-bug variants), grouped by sync + reporter.
        // Only QA-category rows get populated; developer/other rows stay at 0.
        await queryInterface.sequelize.query(`
            UPDATE perf_member_scores pms
            SET sub_bugs_raised_count = COALESCE(sub.cnt, 0)
            FROM (
                SELECT sync_id, reporter_jira_id, COUNT(*) AS cnt
                FROM perf_ticket_facts
                WHERE LOWER(issue_type) LIKE '%bug%'
                  AND LOWER(issue_type) <> 'bug'
                  AND reporter_jira_id IS NOT NULL
                GROUP BY sync_id, reporter_jira_id
            ) sub
            WHERE pms.sync_id = sub.sync_id
              AND pms.jira_login_id = sub.reporter_jira_id
              AND pms.member_category = 'qa'
        `);
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('perf_member_scores', 'sub_bugs_raised_count');
    },
};
