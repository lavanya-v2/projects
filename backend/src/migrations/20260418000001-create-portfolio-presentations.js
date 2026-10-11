'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('portfolio_presentations', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                allowNull: false,
            },
            account_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'accounts', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            title: {
                type: Sequelize.STRING,
                allowNull: false,
            },
            meeting_date: {
                type: Sequelize.DATEONLY,
                allowNull: false,
            },
            start_date: {
                type: Sequelize.DATEONLY,
                allowNull: false,
            },
            end_date: {
                type: Sequelize.DATEONLY,
                allowNull: false,
            },
            health: {
                type: Sequelize.STRING,
                allowNull: false,
                defaultValue: 'Green',
            },
            selected_project_ids: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            selected_sprint_map: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: {},
            },
            key_highlights: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: {},
            },
            milestones: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            risks: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            action_items_snapshot: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            tech_recommendations: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            discussion_points: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            per_project_drilldown: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: [],
            },
            trend_data: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: {},
            },
            created_by_user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL',
            },
            meeting_transcript: {
                type: Sequelize.TEXT,
                allowNull: true,
            },
            mom_content: {
                type: Sequelize.TEXT,
                allowNull: true,
            },
            mom_generated_at: {
                type: Sequelize.DATE,
                allowNull: true,
            },
            mom_status: {
                type: Sequelize.STRING(20),
                allowNull: true,
            },
            locked_at: {
                type: Sequelize.DATE,
                allowNull: true,
            },
            locked_by_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL',
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

        await queryInterface.addIndex('portfolio_presentations', ['account_id'], {
            name: 'portfolio_presentations_account_id_idx',
        });

        await queryInterface.addIndex('portfolio_presentations', ['start_date', 'end_date'], {
            name: 'portfolio_presentations_date_range_idx',
        });

        await queryInterface.addIndex('portfolio_presentations', ['account_id', 'meeting_date'], {
            name: 'portfolio_presentations_account_meeting_idx',
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('portfolio_presentations');
    },
};
