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
 * review_cycles — one materialised review period for an account.
 *
 * Weights, template and project scope are SNAPSHOTTED onto the instance rather
 * than read through to the config. A published score is an HR artefact: it must
 * not silently change months later because someone edited the account config or
 * added a project to the pilot.
 *
 * Status is a deliberate ladder. There is no 'collecting' state (it existed in an
 * earlier draft to drive reminders, and with notifications parked it distinguished
 * nothing), and no automatic transition to 'published' — auto-publishing scores
 * partly built from missing-factor defaults is the worst failure available here.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('review_cycles', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            account_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'accounts', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            config_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'review_cycle_configs', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            // Human label: '2026-10' for monthly, 'FY27-Q1' for quarterly.
            period_label: {
                type: Sequelize.STRING(50),
                allowNull: false
            },
            start_date: { type: Sequelize.DATEONLY, allowNull: false },
            end_date: { type: Sequelize.DATEONLY, allowNull: false },
            // 'FY2026-27'. The window over which cumulative scores accumulate.
            review_year: {
                type: Sequelize.STRING(16),
                allowNull: false
            },
            // 1-based position within review_year; drives the trend comparison.
            sequence_no: {
                type: Sequelize.SMALLINT,
                allowNull: false
            },
            status: {
                type: Sequelize.ENUM('scheduled', 'open', 'locked', 'published', 'archived'),
                allowNull: false,
                defaultValue: 'scheduled'
            },

            // ── Snapshotted at open ──────────────────────────────────────────
            weight_system: { type: Sequelize.DECIMAL(5, 2), allowNull: false },
            weight_lead: { type: Sequelize.DECIMAL(5, 2), allowNull: false },
            weight_customer: { type: Sequelize.DECIMAL(5, 2), allowNull: false },
            lead_template_id: { type: Sequelize.INTEGER, allowNull: true },
            scope_project_ids: {
                type: Sequelize.ARRAY(Sequelize.INTEGER),
                allowNull: false,
                defaultValue: []
            },

            opened_at: { type: Sequelize.DATE, allowNull: true },
            locked_at: { type: Sequelize.DATE, allowNull: true },
            published_at: { type: Sequelize.DATE, allowNull: true },
            published_by_user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            ...TIMESTAMPS(Sequelize)
        });

        // Materialisation must be idempotent — generating cycles twice must not
        // duplicate a period.
        await queryInterface.addIndex('review_cycles', ['account_id', 'start_date', 'end_date'], {
            name: 'review_cycles_account_period_unique',
            unique: true
        });
        await queryInterface.addIndex('review_cycles', ['account_id', 'review_year', 'sequence_no'], {
            name: 'review_cycles_account_year_seq_idx'
        });
        await queryInterface.addIndex('review_cycles', ['status'], {
            name: 'review_cycles_status_idx'
        });

        await queryInterface.sequelize.query(`
            ALTER TABLE review_cycles
              ADD CONSTRAINT review_cycles_dates_ordered CHECK (end_date >= start_date);
        `);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('review_cycles');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_review_cycles_status";');
    }
};
