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
 * review_cycle_sources — which delivery syncs feed a cycle.
 *
 * A table rather than a JSONB array of ids for two reasons:
 *   1. A lead must be able to exclude a bad sprint from an HR score WITH a
 *      recorded reason and attribution.
 *   2. When a sprint is re-synced we need the reverse lookup "which cycles does
 *      this affect?" — a JSONB array makes that a scan and gives no FK.
 *
 * `project_id` is meaningful here precisely because a cycle spans projects: it is
 * how a member's score can be explained back to where the work happened.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('review_cycle_sources', {
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
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'projects', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            source_type: {
                type: Sequelize.ENUM('sprint', 'kanban', 'excel_import'),
                allowNull: false
            },
            perf_sprint_sync_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'perf_sprint_syncs', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            // For sources that are not perf_sprint_syncs rows (Excel imports).
            external_source_id: {
                type: Sequelize.STRING(64),
                allowNull: true
            },
            attached_by: {
                type: Sequelize.ENUM('auto', 'manual'),
                allowNull: false,
                defaultValue: 'auto'
            },
            excluded: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false
            },
            exclusion_reason: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            excluded_by_user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            ...TIMESTAMPS(Sequelize)
        });

        // A sync attaches to a cycle at most once. Partial, because
        // external-source rows carry a NULL sync id and several may coexist.
        await queryInterface.addIndex('review_cycle_sources', ['review_cycle_id', 'perf_sprint_sync_id'], {
            name: 'review_cycle_sources_cycle_sync_unique',
            unique: true,
            where: { perf_sprint_sync_id: { [Sequelize.Op.ne]: null } }
        });
        // The "which cycles does this re-synced sprint affect?" lookup.
        await queryInterface.addIndex('review_cycle_sources', ['perf_sprint_sync_id'], {
            name: 'review_cycle_sources_sync_idx'
        });
        await queryInterface.addIndex('review_cycle_sources', ['review_cycle_id', 'excluded'], {
            name: 'review_cycle_sources_cycle_excluded_idx'
        });

        // Exactly one of the two source identifiers must be set.
        await queryInterface.sequelize.query(`
            ALTER TABLE review_cycle_sources
              ADD CONSTRAINT review_cycle_sources_one_source
              CHECK ((perf_sprint_sync_id IS NULL) <> (external_source_id IS NULL));
        `);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('review_cycle_sources');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_review_cycle_sources_source_type";');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_review_cycle_sources_attached_by";');
    }
};
