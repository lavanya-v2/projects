'use strict';

/**
 * team_members.jira_login_id is UNIQUE NOT NULL, which quietly means "you cannot
 * be on a delivery roster unless you have a Jira account". That is true today
 * only because every project feeding the roster is Jira-backed. The performance
 * review module has to cover Excel projects and people who never touch Jira, so
 * the NOT NULL has to go.
 *
 * UNIQUE stays — Postgres allows multiple NULLs under a unique constraint, so
 * "at most one row per Jira login" is still enforced for everyone who has one.
 *
 * down() restores NOT NULL. It will fail if NULL rows exist by then; that is the
 * correct behaviour rather than inventing placeholder logins on the way back.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.changeColumn('team_members', 'jira_login_id', {
            type: Sequelize.STRING,
            allowNull: true,
            unique: true
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.changeColumn('team_members', 'jira_login_id', {
            type: Sequelize.STRING,
            allowNull: false,
            unique: true
        });
    }
};
