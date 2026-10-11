'use strict';

/**
 * review_status_history — audit trail for every lifecycle transition.
 *
 * Modeled on action_item_status_history: one table with an entity discriminator
 * rather than a history table per entity. `timestamps: false` for the same reason
 * that table uses it — the row IS the timestamp.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('review_status_history', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            // 'cycle' | 'lead_review' | 'member_score'
            entity_type: {
                type: Sequelize.STRING(30),
                allowNull: false
            },
            entity_id: {
                type: Sequelize.INTEGER,
                allowNull: false
            },
            from_status: { type: Sequelize.STRING(30), allowNull: true },
            to_status: { type: Sequelize.STRING(30), allowNull: false },
            note: { type: Sequelize.TEXT, allowNull: true },
            changed_by_user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            changed_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            }
        });

        await queryInterface.addIndex('review_status_history', ['entity_type', 'entity_id'], {
            name: 'review_status_history_entity_idx'
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('review_status_history');
    }
};
