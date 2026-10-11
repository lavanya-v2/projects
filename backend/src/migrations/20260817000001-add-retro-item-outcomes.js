'use strict';

/**
 * Outcome tracking for agreed retro points.
 *
 * A top-3 point previously lived only inside the board that produced it: once
 * that retro completed the board froze and the commitment was never surfaced
 * again. These columns let a later retro record what actually happened to each
 * agreed point — including "nothing", which is the case worth catching.
 *
 * Purely additive. No existing column changes, no backfill: a NULL outcome
 * simply means "not yet reviewed", which is the correct state for every row
 * that exists today.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('retro_items', 'outcome', {
            type: Sequelize.ENUM('DONE', 'STILL_OPEN', 'DROPPED'),
            allowNull: true,
        });

        await queryInterface.addColumn('retro_items', 'outcome_note', {
            type: Sequelize.TEXT,
            allowNull: true,
        });

        await queryInterface.addColumn('retro_items', 'outcome_at', {
            type: Sequelize.DATE,
            allowNull: true,
        });

        await queryInterface.addColumn('retro_items', 'outcome_by_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
        });

        // Which later retro reviewed this point. Gives the audit chain —
        // "agreed on 12 Aug, reviewed and dropped in the 26 Aug retro".
        await queryInterface.addColumn('retro_items', 'outcome_reviewed_in_board_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'retro_boards', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
        });

        await queryInterface.addIndex('retro_items', ['board_id', 'outcome']);
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('retro_items', ['board_id', 'outcome']);
        await queryInterface.removeColumn('retro_items', 'outcome_reviewed_in_board_id');
        await queryInterface.removeColumn('retro_items', 'outcome_by_id');
        await queryInterface.removeColumn('retro_items', 'outcome_at');
        await queryInterface.removeColumn('retro_items', 'outcome_note');
        await queryInterface.removeColumn('retro_items', 'outcome');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_retro_items_outcome";');
    },
};
