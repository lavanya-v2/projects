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

/**
 * The lead's review of one person for one cycle.
 *
 * This feeds an appraisal, so the design is built around being able to defend the
 * number later:
 *
 *  - `evidence_snapshot` freezes the delivery figures the lead was actually shown
 *    at submission. Delivery data is re-synced routinely and `perf_member_scores`
 *    rows are replaced wholesale, so without this you could never prove what a
 *    rating was made against.
 *  - `status` IS the visibility rule: the lead drafts privately, the member sees
 *    only `published`.
 *  - A published review is IMMUTABLE. A correction creates a new version pointing
 *    at the old one via `supersedes_review_id`, and both are kept — the record the
 *    member saw can never be silently altered.
 *  - `acknowledged_at` records that the member saw it, which is what evidences the
 *    conversation actually happened.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('lead_reviews', {
            id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
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
            /** Denormalised from the cycle so permission scoping needs no join. */
            account_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'accounts', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            reviewer_user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'RESTRICT'
            },
            /** The exact template VERSION answered. Never the family, always the version. */
            template_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'competency_templates', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'RESTRICT'
            },

            status: {
                type: Sequelize.ENUM('draft', 'submitted', 'published', 'superseded', 'withdrawn'),
                allowNull: false,
                defaultValue: 'draft'
            },

            overall_comment: { type: Sequelize.TEXT, allowNull: true },
            strengths: { type: Sequelize.TEXT, allowNull: true },
            improvements: { type: Sequelize.TEXT, allowNull: true },

            /** 0-100, derived from the weighted ratings at submission. */
            normalized_score: { type: Sequelize.DECIMAL(5, 2), allowNull: true },

            /**
             * The delivery figures shown to the lead at submit: system score,
             * coverage, per-source breakdown, and the template as answered. Frozen,
             * so a later re-sync cannot change what the rating was made against.
             */
            evidence_snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },

            // ── Versioning ───────────────────────────────────────────────────
            version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
            supersedes_review_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'lead_reviews', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            /** Why a correction was needed. Required when superseding. */
            revision_reason: { type: Sequelize.TEXT, allowNull: true },

            submitted_at: { type: Sequelize.DATE, allowNull: true },
            published_at: { type: Sequelize.DATE, allowNull: true },
            published_by_user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },

            // ── Member acknowledgement ───────────────────────────────────────
            acknowledged_at: { type: Sequelize.DATE, allowNull: true },
            acknowledgement_comment: { type: Sequelize.TEXT, allowNull: true },

            ...TIMESTAMPS(Sequelize)
        });

        // One LIVE review per person per cycle. Partial, because superseded
        // versions are retained forever and must not collide with their successor.
        await queryInterface.addIndex('lead_reviews', ['review_cycle_id', 'team_member_id'], {
            name: 'lead_reviews_cycle_member_live_unique',
            unique: true,
            where: { status: { [Sequelize.Op.ne]: 'superseded' } }
        });
        // "What must I review this cycle?" — the lead workspace query.
        await queryInterface.addIndex('lead_reviews', ['reviewer_user_id', 'status'], {
            name: 'lead_reviews_reviewer_status_idx'
        });
        // "Show me my reviews since the beginning" — the member view.
        await queryInterface.addIndex('lead_reviews', ['team_member_id', 'status'], {
            name: 'lead_reviews_member_status_idx'
        });

        // A correction must say why. Without this an amended appraisal record has
        // no explanation attached to it.
        await queryInterface.sequelize.query(`
            ALTER TABLE lead_reviews
              ADD CONSTRAINT lead_reviews_revision_has_reason
              CHECK (supersedes_review_id IS NULL OR revision_reason IS NOT NULL);
        `);

        // ── Ratings ──────────────────────────────────────────────────────────
        await queryInterface.createTable('lead_review_ratings', {
            id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
            lead_review_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'lead_reviews', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            template_item_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'competency_template_items', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'RESTRICT'
            },
            /** Within the template's scale. NULL when na, or for non-rating items. */
            rating: { type: Sequelize.SMALLINT, allowNull: true },
            text_value: { type: Sequelize.TEXT, allowNull: true },
            boolean_value: { type: Sequelize.BOOLEAN, allowNull: true },
            /** The justification. Mandatory for every rating — see leadReviewService. */
            comment: { type: Sequelize.TEXT, allowNull: true },
            /** Explicitly not applicable. Excluded from the weighted score. */
            na: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
            ...TIMESTAMPS(Sequelize)
        });

        await queryInterface.addIndex('lead_review_ratings', ['lead_review_id', 'template_item_id'], {
            name: 'lead_review_ratings_review_item_unique',
            unique: true
        });
        // Powers per-competency trends across cycles.
        await queryInterface.addIndex('lead_review_ratings', ['template_item_id'], {
            name: 'lead_review_ratings_item_idx'
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('lead_review_ratings');
        await queryInterface.dropTable('lead_reviews');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_lead_reviews_status";');
    }
};
