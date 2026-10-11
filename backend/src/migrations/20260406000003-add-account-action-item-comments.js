'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        // Make action_item_id nullable so comments can belong to account action items
        await queryInterface.changeColumn('action_item_comments', 'action_item_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
        });

        // Add account_action_item_id column
        await queryInterface.addColumn('action_item_comments', 'account_action_item_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'account_action_items', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
        });

        // Ensure every comment belongs to at least one parent
        await queryInterface.sequelize.query(
            'ALTER TABLE action_item_comments ADD CONSTRAINT chk_comment_parent CHECK (action_item_id IS NOT NULL OR account_action_item_id IS NOT NULL)'
        );
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(
            'ALTER TABLE action_item_comments DROP CONSTRAINT IF EXISTS chk_comment_parent'
        );
        await queryInterface.removeColumn('action_item_comments', 'account_action_item_id');
        await queryInterface.changeColumn('action_item_comments', 'action_item_id', {
            type: Sequelize.INTEGER,
            allowNull: false,
        });
    },
};
