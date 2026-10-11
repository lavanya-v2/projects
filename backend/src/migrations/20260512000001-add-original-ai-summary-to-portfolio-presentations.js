'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('portfolio_presentations', 'original_ai_summary', {
            type: Sequelize.TEXT,
            allowNull: true,
        });

        // Backfill existing rows: treat their current key_highlights.summary as the
        // baseline, so the first refresh after deploy doesn't immediately overwrite
        // user-edited summaries. Refresh logic compares against original_ai_summary;
        // equal => regenerate, different => preserve user edit.
        await queryInterface.sequelize.query(`
            UPDATE portfolio_presentations
            SET original_ai_summary = key_highlights->>'summary'
            WHERE original_ai_summary IS NULL
              AND key_highlights ? 'summary'
        `);
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('portfolio_presentations', 'original_ai_summary');
    },
};
