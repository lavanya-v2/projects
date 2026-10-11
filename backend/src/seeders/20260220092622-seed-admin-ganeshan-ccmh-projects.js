'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Get the user
    const users = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE user_id = 'ganeshan.a@v2solutions.com';`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    if (users.length === 0) {
      console.log('User ganeshan.a@v2solutions.com not found. Skipping seeder.');
      return;
    }
    const userId = users[0].id;

    // 2. Get the CCMH account
    const accounts = await queryInterface.sequelize.query(
      `SELECT id FROM accounts WHERE code = 'CCMH';`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    if (accounts.length === 0) {
      console.log('Account CCMH not found. Skipping seeder.');
      return;
    }
    const accountId = accounts[0].id;

    // 3. Get all project IDs under CCMH
    const projects = await queryInterface.sequelize.query(
      `SELECT id FROM projects WHERE account_id = ${accountId};`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    const projectIds = projects.map(p => p.id);

    // 4. Upsert the permission
    const existingPerms = await queryInterface.sequelize.query(
      `SELECT id FROM user_permissions WHERE user_id = ${userId} AND account_id = ${accountId};`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    if (existingPerms.length > 0) {
      // Update
      await queryInterface.sequelize.query(
        `UPDATE user_permissions SET project_ids = ARRAY[${projectIds.join(',')}]::integer[], updated_at = NOW() WHERE id = ${existingPerms[0].id};`
      );
    } else {
      // Insert
      await queryInterface.sequelize.query(
        `INSERT INTO user_permissions (user_id, account_id, project_ids, created_at, updated_at) VALUES (${userId}, ${accountId}, ARRAY[${projectIds.join(',')}]::integer[], NOW(), NOW());`
      );
    }
  },

  async down(queryInterface, Sequelize) {
    // Optionally remove the permission, but since it's an admin permission, probably better to just leave it 
    // or reset the project_ids.
    const users = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE user_id = 'ganeshan.a@v2solutions.com';`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    if (users.length > 0) {
      await queryInterface.sequelize.query(
        `UPDATE user_permissions SET project_ids = '{}'::integer[] WHERE user_id = ${users[0].id};`
      );
    }
  }
};
