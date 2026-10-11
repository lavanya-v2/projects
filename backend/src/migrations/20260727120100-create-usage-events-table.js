'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('usage_events', {
            id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
            user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onDelete: 'CASCADE',
            },
            session_id: { type: Sequelize.STRING(64), allowNull: true },
            role_name: { type: Sequelize.STRING(50), allowNull: true },
            event_type: { type: Sequelize.STRING(40), allowNull: false },
            feature: { type: Sequelize.STRING(60), allowNull: true },
            method: { type: Sequelize.STRING(10), allowNull: true },
            path: { type: Sequelize.STRING(255), allowNull: true },
            status_code: { type: Sequelize.INTEGER, allowNull: true },
            duration_ms: { type: Sequelize.INTEGER, allowNull: true },
            // Deliberately no FK — best-effort capture from route params; the
            // project may be deleted while the usage history should survive.
            project_id: { type: Sequelize.INTEGER, allowNull: true },
            occurred_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        });

        await queryInterface.addIndex('usage_events', ['user_id', 'occurred_at'], {
            name: 'usage_events_user_id_occurred_at_idx',
        });
        await queryInterface.addIndex('usage_events', ['occurred_at', 'event_type'], {
            name: 'usage_events_occurred_at_event_type_idx',
        });
        await queryInterface.addIndex('usage_events', ['feature'], {
            name: 'usage_events_feature_idx',
        });
        await queryInterface.addIndex('usage_events', ['session_id'], {
            name: 'usage_events_session_id_idx',
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('usage_events');
    },
};
