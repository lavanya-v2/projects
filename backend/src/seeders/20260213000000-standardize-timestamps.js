'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // HEURISTIC: We assume DSRs range from 10 AM IST to 11 PM IST.
        // UTC Range: 04:30 to 17:30.
        // IST Range (Raw): 10:00 to 23:00.
        // Overlap: 10:00 to 17:30.
        // SAFE UPDATE: If HOUR > 17 (5:30 PM), it is almost certainly IST (as 17:00 UTC is 10:30 PM IST).
        // Updates for hours 10-17 are ambiguous, but we apply a safe filter > 16 to catch late-day reports stored as IST.

        await queryInterface.sequelize.query(`
      UPDATE daily_board_snapshots 
      SET 
        created_at = created_at - INTERVAL '5 hours 30 minutes',
        updated_at = updated_at - INTERVAL '5 hours 30 minutes'
      WHERE 
        created_at IS NOT NULL 
        AND EXTRACT(HOUR FROM created_at) >= 16 -- Only convert if hour is 16:00 (4 PM) or later, likely implying IST local time storage.
    `);

        console.log('Standardized timestamps: Converted likely-IST records (Hour >= 16) to UTC.');
    },

    async down(queryInterface, Sequelize) {
        // Revert the change (Add 5.5 hours back)
        await queryInterface.sequelize.query(`
      UPDATE daily_board_snapshots 
      SET 
        created_at = created_at + INTERVAL '5 hours 30 minutes',
        updated_at = updated_at + INTERVAL '5 hours 30 minutes'
      WHERE 
        created_at IS NOT NULL
        AND EXTRACT(HOUR FROM created_at) <= 17 -- Approximate reversal logic
    `);
    }
};
