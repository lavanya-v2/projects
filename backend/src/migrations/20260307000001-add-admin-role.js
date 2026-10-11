'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      INSERT INTO roles (name, description, created_at, updated_at)
      VALUES ('admin', 'Admin access to all modules except User Management', NOW(), NOW())
      ON CONFLICT (name) DO NOTHING;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE FROM roles WHERE name = 'admin';
    `);
  }
};
