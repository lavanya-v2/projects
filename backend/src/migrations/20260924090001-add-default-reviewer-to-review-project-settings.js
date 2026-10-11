'use strict';

/**
 * A per-project default reviewer, set once during Setup and applied to every
 * participant whose dominant project is this one — an explicit choice, ahead
 * of the existing single-unambiguous-lead auto-pick, not a replacement for it.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('review_project_settings', 'default_reviewer_user_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('review_project_settings', 'default_reviewer_user_id');
    },
};
