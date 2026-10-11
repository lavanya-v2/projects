'use strict';

/**
 * Drop three indexes on perf_ticket_facts confirmed UNUSED on production.
 *
 * Evidence (pg_stat_user_indexes, lifetime counters — prod stats_reset is NULL):
 *   perf_ticket_facts_jira_key_created_at_idx : idx_scan = 0  (1320 kB)
 *   perf_ticket_facts_project_id_jira_key     : idx_scan = 0  ( 872 kB)
 *   perf_ticket_facts_qa_tester_jira_id       : idx_scan = 0  ( 336 kB)
 * Combined ~2.5 MB reclaimed + fewer indexes maintained per insert during sync.
 *
 * Kept (actively used): pkey, sync_id (333 scans), assignee_jira_id (373),
 * sync_key_unique (2336). Read paths are sync_id-scoped, so dropping these
 * zero-scan indexes has no API read impact. Fully reversible via down().
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface) {
        await queryInterface.removeIndex('perf_ticket_facts', 'perf_ticket_facts_jira_key_created_at_idx');
        await queryInterface.removeIndex('perf_ticket_facts', 'perf_ticket_facts_project_id_jira_key');
        await queryInterface.removeIndex('perf_ticket_facts', 'perf_ticket_facts_qa_tester_jira_id');
    },

    async down(queryInterface) {
        await queryInterface.addIndex('perf_ticket_facts', ['jira_key', 'jira_created_at'], {
            name: 'perf_ticket_facts_jira_key_created_at_idx',
        });
        await queryInterface.addIndex('perf_ticket_facts', ['project_id', 'jira_key'], {
            name: 'perf_ticket_facts_project_id_jira_key',
        });
        await queryInterface.addIndex('perf_ticket_facts', ['qa_tester_jira_id'], {
            name: 'perf_ticket_facts_qa_tester_jira_id',
        });
    },
};
