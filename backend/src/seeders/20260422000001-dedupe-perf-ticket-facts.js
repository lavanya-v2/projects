'use strict';

module.exports = {
    up: async (queryInterface) => {
        await queryInterface.sequelize.query(`
            DELETE FROM perf_ticket_facts t1
            USING perf_ticket_facts t2
            WHERE t1.sync_id = t2.sync_id
              AND t1.jira_key = t2.jira_key
              AND t1.id > t2.id;
        `);
    },

    down: async () => {
        // one-way cleanup; deleted duplicates are not restorable
    },
};
