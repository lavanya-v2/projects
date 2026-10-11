'use strict';

/**
 * Project-level "Dev Assistant AI Tool" setting — which coding assistant (if
 * any) a project's team actually uses. Gates every Claude-usage UI surface
 * (nav section, dashboard card, Team Prompt Coaching) as an OUTER gate in
 * front of the existing per-user pilot allowlist: a project not set to
 * 'claude' shows nothing Claude-related at all, not even a "coming soon"
 * message. Defaults to 'none' so every existing project stays silent until
 * an admin explicitly opts it in.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('projects', 'dev_assistant_ai_tool', {
            type: Sequelize.STRING(20),
            allowNull: false,
            defaultValue: 'none',
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('projects', 'dev_assistant_ai_tool');
    },
};
