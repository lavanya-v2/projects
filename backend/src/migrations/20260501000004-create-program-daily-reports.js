'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('program_daily_reports', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                allowNull: false,
            },
            program_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'programs', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            account_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'accounts', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            report_date: {
                type: Sequelize.DATEONLY,
                allowNull: false,
            },
            summary: {
                type: Sequelize.TEXT,
                allowNull: true,
            },
            health: {
                type: Sequelize.STRING,
                allowNull: true,
            },
            risks: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: { summary: '', items: [] },
            },
            key_accomplishments: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            red_projects: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            projects_included: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            projects_missing: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            action_items: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            manager_insights: {
                type: Sequelize.TEXT,
                allowNull: true,
            },
            original_executive_summary: {
                type: Sequelize.TEXT,
                allowNull: true,
            },
            insights_author_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
            },
            insights_author_name: {
                type: Sequelize.STRING(200),
                allowNull: true,
            },
            file_path: {
                type: Sequelize.TEXT,
                allowNull: true,
            },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('NOW()'),
            },
            updated_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('NOW()'),
            },
        });

        await queryInterface.addIndex('program_daily_reports', ['program_id', 'report_date'], {
            unique: true,
            name: 'unique_program_daily_report',
        });

        await queryInterface.addIndex('program_daily_reports', ['account_id'], {
            name: 'program_daily_reports_account_id_idx',
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('program_daily_reports');
    },
};
