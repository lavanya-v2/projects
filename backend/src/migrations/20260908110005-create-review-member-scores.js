'use strict';

const TIMESTAMPS = (Sequelize) => ({
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

const SCORE = (Sequelize) => ({ type: Sequelize.DECIMAL(5, 2), allowNull: true });

/**
 * review_member_scores — the computed composite, snapshotted.
 *
 * A SNAPSHOT rather than a computed-on-read view, because
 * performanceSyncService.computeAndSaveScores() DELETES and recreates
 * perf_member_scores rows on every re-sync. A score computed on read would
 * silently change months after it was published. `input_hash` makes that drift
 * detectable rather than invisible, and locked cycles never recompute.
 *
 * Customer columns are present but unused in v1 — three nullable columns cost
 * nothing and save a migration when the factor is switched on.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('review_member_scores', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            review_cycle_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'review_cycles', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            team_member_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'team_members', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            member_category: {
                type: Sequelize.STRING(20),
                allowNull: false,
                defaultValue: 'developer'
            },

            // ── Weights as they applied to THIS score ────────────────────────
            weight_system: { type: Sequelize.DECIMAL(5, 2), allowNull: false },
            weight_lead: { type: Sequelize.DECIMAL(5, 2), allowNull: false },
            weight_customer: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },

            // ── Period factors (0-100, higher = better) ──────────────────────
            system_score: SCORE(Sequelize),
            lead_score: SCORE(Sequelize),
            customer_score: SCORE(Sequelize),
            composite_score: SCORE(Sequelize),

            // Presence: false means the factor was absent and defaulted to 100.
            // A factor at weight 0 is OUT OF SCOPE and is neither present nor
            // missing — it is excluded from the composite and coverage entirely.
            system_present: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
            lead_present: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
            customer_present: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },

            // ── Coverage (0-100) ─────────────────────────────────────────────
            system_coverage: SCORE(Sequelize),
            lead_coverage: SCORE(Sequelize),
            customer_coverage: SCORE(Sequelize),
            overall_coverage: SCORE(Sequelize),

            // Provisional when coverage < 60 OR any in-scope factor is absent.
            // The second clause is not redundant: at 60/40 weights an entirely
            // un-reviewed person lands at exactly 60, just above a bare threshold.
            is_provisional: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },

            // ── Cumulative, year-to-date within review_year ──────────────────
            cum_system_score: SCORE(Sequelize),
            cum_lead_score: SCORE(Sequelize),
            cum_customer_score: SCORE(Sequelize),
            cum_composite_score: SCORE(Sequelize),
            cum_coverage: SCORE(Sequelize),
            cum_cycles_count: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 0 },

            // ── Trend vs the previous cycle in the same review year ──────────
            trend_direction: {
                type: Sequelize.ENUM('improved', 'declined', 'flat', 'na'),
                allowNull: false,
                defaultValue: 'na'
            },
            trend_delta: { type: Sequelize.DECIMAL(6, 2), allowNull: true },

            // ── Audit ────────────────────────────────────────────────────────
            // Per-source and per-metric detail, approximations applied, overrides
            // used, category flips. Shape varies by provider and nothing queries
            // into it, so JSONB is right here.
            breakdown: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
            computed_at: { type: Sequelize.DATE, allowNull: true },
            computed_by: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'auto' },
            engine_version: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'v1' },
            // Hash of the inputs. A locked cycle whose inputs no longer hash to
            // this has drifted and must be flagged rather than silently trusted.
            input_hash: { type: Sequelize.STRING(64), allowNull: true },

            is_published: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
            published_at: { type: Sequelize.DATE, allowNull: true },
            ...TIMESTAMPS(Sequelize)
        });

        // One score per person per cycle. Two rows for one person means account
        // scoping has broken and a cross-project member has been double-counted.
        await queryInterface.addIndex('review_member_scores', ['review_cycle_id', 'team_member_id'], {
            name: 'review_member_scores_cycle_member_unique',
            unique: true
        });
        // The member's own "since the beginning" history query.
        await queryInterface.addIndex('review_member_scores', ['team_member_id', 'is_published'], {
            name: 'review_member_scores_member_published_idx'
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('review_member_scores');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_review_member_scores_trend_direction";');
    }
};
