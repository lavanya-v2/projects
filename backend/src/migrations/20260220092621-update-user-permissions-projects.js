'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // We remove project_id and access_level, and add project_ids (INTEGER[])
    await queryInterface.removeColumn('user_permissions', 'project_id');
    await queryInterface.removeColumn('user_permissions', 'access_level');

    await queryInterface.addColumn('user_permissions', 'project_ids', {
      type: Sequelize.ARRAY(Sequelize.INTEGER),
      allowNull: true,
      defaultValue: [] // Using empty array to mean no assigned projects by default
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('user_permissions', 'project_ids');

    // We recreate the columns if rolling back
    await queryInterface.addColumn('user_permissions', 'project_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'projects', key: 'id' }
    });

    // access_level was an ENUM, but for a rollback we might just use STRING to avoid enum recreation issues
    await queryInterface.addColumn('user_permissions', 'access_level', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'ACCOUNT'
    });
  }
};
