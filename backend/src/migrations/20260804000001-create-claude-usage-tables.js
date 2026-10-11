'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // --- per-user personal ingest tokens (machine-to-server credential) ---
        await queryInterface.createTable('usage_ingest_tokens', {
            id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
            user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onDelete: 'CASCADE',
            },
            token_hash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
            last_four: { type: Sequelize.STRING(4), allowNull: true },
            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
            revoked_at: { type: Sequelize.DATE, allowNull: true },
            last_seen_at: { type: Sequelize.DATE, allowNull: true },
        });
        await queryInterface.addIndex('usage_ingest_tokens', ['user_id'], {
            name: 'usage_ingest_tokens_user_id_idx',
        });

        // --- versioned, revocable consent (gates ingest) ---
        await queryInterface.createTable('usage_collector_consent', {
            id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
            user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onDelete: 'CASCADE',
            },
            consent_version: { type: Sequelize.STRING(20), allowNull: false },
            consent_text_hash: { type: Sequelize.STRING(64), allowNull: true },
            source: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'ui' },
            consented_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
            revoked_at: { type: Sequelize.DATE, allowNull: true },
        });
        await queryInterface.addIndex('usage_collector_consent', ['user_id', 'consent_version'], {
            name: 'usage_collector_consent_user_version_idx',
        });

        // --- one content-free row per user per day (idempotent upsert) ---
        await queryInterface.createTable('claude_usage_daily', {
            id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
            user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onDelete: 'CASCADE',
            },
            day: { type: Sequelize.DATEONLY, allowNull: false },
            metrics: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
            total_prompts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
            avg_score: { type: Sequelize.FLOAT, allowNull: false, defaultValue: 0 },
            vibe_index: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
            collector_version: { type: Sequelize.STRING(20), allowNull: true },
            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        });
        await queryInterface.addIndex('claude_usage_daily', ['user_id', 'day'], {
            unique: true,
            name: 'claude_usage_daily_user_day_unique',
        });

        // --- cached AI coaching tips (one latest row per user; aggregate-derived only) ---
        await queryInterface.createTable('claude_usage_coaching', {
            id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
            user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                unique: true,
                references: { model: 'users', key: 'id' },
                onDelete: 'CASCADE',
            },
            tips: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
            model: { type: Sequelize.STRING(40), allowNull: true },
            based_on_from: { type: Sequelize.DATEONLY, allowNull: true },
            based_on_to: { type: Sequelize.DATEONLY, allowNull: true },
            generated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('claude_usage_coaching');
        await queryInterface.dropTable('claude_usage_daily');
        await queryInterface.dropTable('usage_collector_consent');
        await queryInterface.dropTable('usage_ingest_tokens');
    },
};
