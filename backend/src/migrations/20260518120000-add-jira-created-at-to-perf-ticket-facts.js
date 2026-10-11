'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('perf_ticket_facts', 'jira_created_at', {
            type: Sequelize.DATE,
            allowNull: true,
        });
        await queryInterface.addIndex('perf_ticket_facts', ['jira_key', 'jira_created_at'], {
            name: 'perf_ticket_facts_jira_key_created_at_idx',
        });
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('perf_ticket_facts', 'perf_ticket_facts_jira_key_created_at_idx');
        await queryInterface.removeColumn('perf_ticket_facts', 'jira_created_at');
    },
};
