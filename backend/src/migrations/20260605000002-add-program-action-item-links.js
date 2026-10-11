'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        // Link status-history rows to program action items (shared multi-parent table)
        await queryInterface.addColumn('action_item_status_history', 'program_action_item_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'program_action_items', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
        });

        // Link comments to program action items (shared multi-parent table)
        await queryInterface.addColumn('action_item_comments', 'program_action_item_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'program_action_items', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
        });

        // Extend the parent CHECK to also allow a program parent
        await queryInterface.sequelize.query(
            'ALTER TABLE action_item_comments DROP CONSTRAINT IF EXISTS chk_comment_parent'
        );
        await queryInterface.sequelize.query(
            'ALTER TABLE action_item_comments ADD CONSTRAINT chk_comment_parent CHECK (action_item_id IS NOT NULL OR account_action_item_id IS NOT NULL OR program_action_item_id IS NOT NULL)'
        );
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(
            'ALTER TABLE action_item_comments DROP CONSTRAINT IF EXISTS chk_comment_parent'
        );
        await queryInterface.sequelize.query(
            'ALTER TABLE action_item_comments ADD CONSTRAINT chk_comment_parent CHECK (action_item_id IS NOT NULL OR account_action_item_id IS NOT NULL)'
        );
        await queryInterface.removeColumn('action_item_comments', 'program_action_item_id');
        await queryInterface.removeColumn('action_item_status_history', 'program_action_item_id');
    },
};
