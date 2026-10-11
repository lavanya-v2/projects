'use strict';

module.exports = {
    async up(queryInterface) {
        await queryInterface.addIndex('perf_ticket_facts', ['sync_id', 'jira_key'], {
            unique: true,
            name: 'perf_ticket_facts_sync_key_unique',
        });
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('perf_ticket_facts', 'perf_ticket_facts_sync_key_unique');
    },
};
