'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'data_source_type', {
      type: Sequelize.STRING(32),
      allowNull: false,
      defaultValue: 'jira',
    });

    await queryInterface.addColumn('projects', 'azure_org_url', {
      type: Sequelize.STRING(512),
      allowNull: true,
    });
    await queryInterface.addColumn('projects', 'azure_project', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
    await queryInterface.addColumn('projects', 'azure_team', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
    await queryInterface.addColumn('projects', 'azure_pat', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('projects', 'azure_board_id', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

    await queryInterface.changeColumn('projects', 'jira_board_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.changeColumn('projects', 'jira_name', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.changeColumn('projects', 'jira_base_url', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addIndex('projects', ['data_source_type'], {
      name: 'idx_projects_data_source_type',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('projects', 'idx_projects_data_source_type');

    await queryInterface.changeColumn('projects', 'jira_base_url', {
      type: Sequelize.STRING,
      allowNull: false,
    });
    await queryInterface.changeColumn('projects', 'jira_name', {
      type: Sequelize.STRING,
      allowNull: false,
    });
    await queryInterface.changeColumn('projects', 'jira_board_id', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });

    await queryInterface.removeColumn('projects', 'azure_board_id');
    await queryInterface.removeColumn('projects', 'azure_pat');
    await queryInterface.removeColumn('projects', 'azure_team');
    await queryInterface.removeColumn('projects', 'azure_project');
    await queryInterface.removeColumn('projects', 'azure_org_url');
    await queryInterface.removeColumn('projects', 'data_source_type');
  },
};
