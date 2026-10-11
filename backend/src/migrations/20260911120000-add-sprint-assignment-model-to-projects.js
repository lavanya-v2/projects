'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // Per-project opt-in: does the sprint team pre-plan an individual SP slice per
        // person ('planned' — e.g. CCM, where each V2 member has a fixed target), or
        // does the team commit to a total sprint SP and pick up tickets on the go with
        // no stable per-person/per-subteam scope from day 1 ('on_the_go' — e.g. Thrive's
        // Team Delta)? Defaults to 'planned' everywhere so no existing project's daily
        // report, health calculation, or progress bar changes unless explicitly opted in.
        await queryInterface.addColumn('projects', 'sprint_assignment_model', {
            type: Sequelize.STRING(20),
            allowNull: false,
            defaultValue: 'planned',
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('projects', 'sprint_assignment_model');
    },
};
