'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // Standardize 'project_weekly_reports'
        await queryInterface.sequelize.query(`
      UPDATE project_weekly_reports 
      SET 
        created_at = created_at - INTERVAL '5 hours 30 minutes',
        updated_at = updated_at - INTERVAL '5 hours 30 minutes'
      WHERE 
        created_at IS NOT NULL 
        AND EXTRACT(HOUR FROM created_at) >= 16
    `);
        console.log('Standardized project_weekly_reports timestamps.');

        // Standardize 'account_weekly_reports'
        await queryInterface.sequelize.query(`
      UPDATE account_weekly_reports 
      SET 
        created_at = created_at - INTERVAL '5 hours 30 minutes',
        updated_at = updated_at - INTERVAL '5 hours 30 minutes'
      WHERE 
        created_at IS NOT NULL 
        AND EXTRACT(HOUR FROM created_at) >= 16
    `);
        console.log('Standardized account_weekly_reports timestamps.');

        // Standardize 'monthly_project_reports'
        await queryInterface.sequelize.query(`
      UPDATE monthly_project_reports 
      SET 
        created_at = created_at - INTERVAL '5 hours 30 minutes',
        updated_at = updated_at - INTERVAL '5 hours 30 minutes'
      WHERE 
        created_at IS NOT NULL 
        AND EXTRACT(HOUR FROM created_at) >= 16
    `);
        console.log('Standardized monthly_project_reports timestamps.');
    },

    async down(queryInterface, Sequelize) {
        // Revert 'project_weekly_reports'
        await queryInterface.sequelize.query(`
      UPDATE project_weekly_reports 
      SET 
        created_at = created_at + INTERVAL '5 hours 30 minutes',
        updated_at = updated_at + INTERVAL '5 hours 30 minutes'
      WHERE 
        created_at IS NOT NULL 
        AND EXTRACT(HOUR FROM created_at) <= 17
    `);

        // Revert 'account_weekly_reports'
        await queryInterface.sequelize.query(`
      UPDATE account_weekly_reports 
      SET 
        created_at = created_at + INTERVAL '5 hours 30 minutes',
        updated_at = updated_at + INTERVAL '5 hours 30 minutes'
      WHERE 
        created_at IS NOT NULL 
        AND EXTRACT(HOUR FROM created_at) <= 17
    `);

        // Revert 'monthly_project_reports'
        await queryInterface.sequelize.query(`
      UPDATE monthly_project_reports 
      SET 
        created_at = created_at + INTERVAL '5 hours 30 minutes',
        updated_at = updated_at + INTERVAL '5 hours 30 minutes'
      WHERE 
        created_at IS NOT NULL 
        AND EXTRACT(HOUR FROM created_at) <= 17
    `);
    }
};
