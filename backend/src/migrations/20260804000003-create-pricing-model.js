'use strict';

// v1 rates — a snapshot of config.collector.pricing at the time this shipped.
// Migrations must be self-contained, so the values are inlined here.
const V1_RATES = {
    models: {
        'claude-opus-4-8': { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.5 },
        'claude-opus-4-7': { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.5 },
        'claude-opus-4-6': { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.5 },
        'claude-opus-4-5': { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.5 },
        'claude-sonnet-5': { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
        'claude-sonnet-4-6': { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
        'claude-sonnet-4-5': { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
        'claude-haiku-4-5': { input: 1.0, output: 5.0, cache_write: 1.25, cache_read: 0.1 },
        'claude-fable-5': { input: 10.0, output: 50.0, cache_write: 12.5, cache_read: 1.0 },
    },
    fallback: { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.5 },
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('pricing_model', {
            id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
            version: { type: Sequelize.INTEGER, allowNull: false, unique: true },
            rates: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
            note: { type: Sequelize.STRING(200), allowNull: true },
            effective_from: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
            created_by_user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onDelete: 'SET NULL',
            },
            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        });

        // Seed v1 from the shipped rates.
        await queryInterface.bulkInsert('pricing_model', [
            {
                version: 1,
                rates: JSON.stringify(V1_RATES),
                note: 'Initial cost model (seeded from config).',
                effective_from: Sequelize.literal('NOW()'),
                created_at: Sequelize.literal('NOW()'),
            },
        ]);

        // Stamp each daily row with the pricing version used (frozen thereafter).
        await queryInterface.addColumn('claude_usage_daily', 'pricing_version_id', {
            type: Sequelize.BIGINT,
            allowNull: true,
            references: { model: 'pricing_model', key: 'id' },
            onDelete: 'SET NULL',
        });

        // Backfill existing rows to v1 (their cost was computed with these rates).
        const [[v1]] = await queryInterface.sequelize.query(
            "SELECT id FROM pricing_model WHERE version = 1 LIMIT 1",
        );
        if (v1 && v1.id) {
            await queryInterface.sequelize.query(
                'UPDATE claude_usage_daily SET pricing_version_id = :vid WHERE pricing_version_id IS NULL',
                { replacements: { vid: v1.id } },
            );
        }
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('claude_usage_daily', 'pricing_version_id');
        await queryInterface.dropTable('pricing_model');
    },
};
