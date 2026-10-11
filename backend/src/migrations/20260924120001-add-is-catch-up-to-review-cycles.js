'use strict';

/**
 * Marks a cycle as a superuser-created "catch-up" period — one review
 * covering several skipped pre-setup months at once, scored from the summed
 * ticket data across that whole span. Purely for labeling/filtering/
 * permission checks; the scoring engine has no awareness of cycle width and
 * needs no change to support this.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('review_cycles', 'is_catch_up', {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('review_cycles', 'is_catch_up');
    },
};
