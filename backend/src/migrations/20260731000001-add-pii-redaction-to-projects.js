'use strict';

/**
 * Per-project control over PII redaction of Jira ticket titles.
 *
 * Defaults to TRUE so every existing project — and every project created
 * without the field — is protected by default. Internal boards must opt OUT
 * explicitly rather than customer boards having to opt in.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('projects', 'pii_redaction_enabled', {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('projects', 'pii_redaction_enabled');
    }
};
