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
 * perf_identity_links — the explicit, auditable bridge from a delivery-data
 * identity to a team member.
 *
 * Today the only bridge is buildV2Matcher() in perfAggregation.ts: Levenshtein
 * distance <= 2 on compacted display names. That is acceptable for a trend chart
 * and disqualifying for a score that reaches HR — "Amit Sharma" and "Amit Sharme"
 * collide silently. The fuzzy matcher survives only as a seeder for `suggested`
 * rows that a superuser must confirm.
 *
 * A table rather than a JSONB alias array on team_members because this is a join
 * key: it needs real FKs, an audit trail (who confirmed it, when, by what
 * method), and time bounds for leavers and rejoiners. A JSONB array forbids the
 * FK and turns "which scores are unattributed?" into a full scan.
 *
 * Keying on (project_id, source, source_key) is also what makes non-Jira
 * projects work with no further schema change: Excel identifies people by a
 * display name, which is unique only within a project, so it becomes a
 * first-class source_key rather than a special case.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('perf_identity_links', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'projects', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            // Nullable because a REJECTED identity has no team member to point at.
            // Measured on real CCM data, ~48% of delivery rows belong to client-side
            // staff working in the customer's own Jira who are not reviewable at all;
            // marking them out of scope is a decision that has to be recordable.
            // The CHECK below still guarantees a confirmed link always resolves.
            team_member_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'team_members', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            // Which delivery system this identity came from. Adding a source is
            // additive: no migration, just a new factor provider.
            source: {
                type: Sequelize.ENUM('jira', 'excel', 'azure'),
                allowNull: false
            },
            // The identity as the source knows it: a Jira accountId, or
            // normalizeName(displayName) for Excel. Never an email.
            source_key: {
                type: Sequelize.STRING(255),
                allowNull: false
            },
            source_display_name: {
                type: Sequelize.STRING(255),
                allowNull: true
            },
            match_method: {
                type: Sequelize.ENUM('auto_email', 'auto_fuzzy', 'manual'),
                allowNull: false
            },
            // 0..1, recorded by the seeder so the review UI can sort the weakest
            // suggestions to the top for confirmation.
            match_confidence: {
                type: Sequelize.FLOAT,
                allowNull: true
            },
            status: {
                type: Sequelize.ENUM('suggested', 'confirmed', 'rejected'),
                allowNull: false,
                defaultValue: 'suggested'
            },
            confirmed_by_user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            confirmed_at: {
                type: Sequelize.DATE,
                allowNull: true
            },
            // Account changes, leavers and rejoiners: a source_key can legitimately
            // point at different people across time. NULL means unbounded.
            effective_from: {
                type: Sequelize.DATEONLY,
                allowNull: true
            },
            effective_to: {
                type: Sequelize.DATEONLY,
                allowNull: true
            },
            is_active: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: true
            },
            ...TIMESTAMPS(Sequelize)
        });

        // A confirmed link MUST resolve to a team member; suggested and rejected
        // rows may not. This is the invariant the whole scoring path relies on.
        await queryInterface.sequelize.query(`
            ALTER TABLE perf_identity_links
              ADD CONSTRAINT perf_identity_links_confirmed_has_member
              CHECK (status <> 'confirmed' OR team_member_id IS NOT NULL);
        `);

        // One live identity per (project, source, key). Partial so that a
        // deactivated historical link does not block a re-link.
        await queryInterface.addIndex('perf_identity_links', ['project_id', 'source', 'source_key'], {
            name: 'perf_identity_links_project_source_key_unique',
            unique: true,
            where: { is_active: true }
        });

        // "Which source identities does this person have?" — the read path used
        // by every factor provider.
        await queryInterface.addIndex('perf_identity_links', ['team_member_id'], {
            name: 'perf_identity_links_team_member_idx'
        });

        // Drives the coverage gate and the confirmation queue.
        await queryInterface.addIndex('perf_identity_links', ['project_id', 'status'], {
            name: 'perf_identity_links_project_status_idx'
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('perf_identity_links');
        // createTable's ENUMs are not dropped with the table on Postgres.
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_perf_identity_links_source";');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_perf_identity_links_match_method";');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_perf_identity_links_status";');
    }
};
