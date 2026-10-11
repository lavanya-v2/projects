'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('user_sessions', {
            id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
            session_id: { type: Sequelize.STRING(64), allowNull: false, unique: true },
            user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onDelete: 'CASCADE',
            },
            role_name: { type: Sequelize.STRING(50), allowNull: true },
            ip_address: { type: Sequelize.STRING(64), allowNull: true },
            user_agent: { type: Sequelize.STRING(512), allowNull: true },
            started_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
            last_seen_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
            ended_at: { type: Sequelize.DATE, allowNull: true },
            end_reason: { type: Sequelize.STRING(20), allowNull: true },
        });

        await queryInterface.addIndex('user_sessions', ['user_id', 'started_at'], {
            name: 'user_sessions_user_id_started_at_idx',
        });
        await queryInterface.addIndex('user_sessions', ['started_at'], {
            name: 'user_sessions_started_at_idx',
        });
        // Partial index: closeStaleSessions() only ever scans still-open sessions.
        await queryInterface.addIndex('user_sessions', ['ended_at'], {
            name: 'user_sessions_open_idx',
            where: { ended_at: null },
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('user_sessions');
    },
};
