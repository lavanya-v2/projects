'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        // Create risks table
        await queryInterface.createTable('risks', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            source: {
                type: Sequelize.ENUM('CLIENT', 'INTERNAL'),
                allowNull: false
            },
            notified_date: {
                type: Sequelize.DATEONLY,
                allowNull: false
            },
            title: {
                type: Sequelize.STRING(255),
                allowNull: false
            },
            description: {
                type: Sequelize.TEXT,
                allowNull: false
            },
            priority: {
                type: Sequelize.ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW'),
                allowNull: false
            },
            status: {
                type: Sequelize.ENUM('NEW', 'WORK_IN_PROGRESS', 'STALE', 'DONE'),
                allowNull: false,
                defaultValue: 'NEW'
            },
            creator_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'RESTRICT'
            },
            assignee_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            },
            updated_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            }
        });

        await queryInterface.addIndex('risks', ['status']);
        await queryInterface.addIndex('risks', ['priority']);

        // Create risk_mitigation_plans table
        await queryInterface.createTable('risk_mitigation_plans', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            risk_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'risks', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            description: {
                type: Sequelize.TEXT,
                allowNull: false
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            },
            updated_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            }
        });

        // Create risk_comments table
        await queryInterface.createTable('risk_comments', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            risk_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'risks', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'RESTRICT'
            },
            comment: {
                type: Sequelize.TEXT,
                allowNull: false
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            },
            updated_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            }
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('risk_comments');
        await queryInterface.dropTable('risk_mitigation_plans');
        await queryInterface.dropTable('risks');
        // Drop ENUM types created by Sequelize
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_risks_source";');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_risks_priority";');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_risks_status";');
    }
};
