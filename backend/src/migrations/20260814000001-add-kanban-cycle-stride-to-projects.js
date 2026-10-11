'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // Null means "back-to-back" -- stride defaults to kanban_cycle_days at
        // read time (kanbanCycleService.resolveStride), so every existing
        // project's cycles are unchanged by this column existing. Only a
        // project that explicitly sets a stride longer than its window
        // (e.g. window 5 / stride 7 for a Mon-Fri cadence) gets the new
        // weekday-aligned behaviour.
        await queryInterface.addColumn('projects', 'kanban_cycle_stride_days', {
            type: Sequelize.INTEGER,
            allowNull: true,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('projects', 'kanban_cycle_stride_days');
    },
};
