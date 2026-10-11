'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Create ENUM type
    await queryInterface.sequelize.query(`
      CREATE TYPE enum_users_role AS ENUM ('USER', 'SUPERUSER');
    `);

    // 2. Add role column
    await queryInterface.addColumn('users', 'role', {
      type: Sequelize.ENUM('USER', 'SUPERUSER'),
      allowNull: false,
      defaultValue: 'USER'
    });
  },

  async down(queryInterface, Sequelize) {
    // 1. Remove column
    await queryInterface.removeColumn('users', 'role');

    // 2. Drop ENUM type
    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS enum_users_role;
    `);
  }
};
