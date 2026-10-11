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
 * review_cycle_configs — one row per ACCOUNT.
 *
 * Account-scoped, not project-scoped, because people work across projects.
 * Measured on CCM: of 216 people, 108 appear in two or more of the account's ~20
 * projects and one appears in eight. Project-scoped cycles would hand that person
 * eight separate reviews per quarter and no single number for HR.
 *
 * `scope_project_ids` is how a pilot stays small on an account-scoped model:
 * empty = every project in the account, otherwise only the listed ones feed
 * cycles and define who participates.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('review_cycle_configs', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            account_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                unique: true,
                references: { model: 'accounts', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            // Empty array = the whole account. Mirrors user_permissions.project_ids.
            scope_project_ids: {
                type: Sequelize.ARRAY(Sequelize.INTEGER),
                allowNull: false,
                defaultValue: []
            },
            cadence: {
                type: Sequelize.ENUM('monthly', 'quarterly'),
                allowNull: false,
                defaultValue: 'monthly'
            },
            anchor_date: {
                type: Sequelize.DATEONLY,
                allowNull: false
            },
            timezone: {
                type: Sequelize.STRING(64),
                allowNull: false,
                defaultValue: 'Asia/Kolkata'
            },
            // 4 = April, the Indian FY start. Defines the window for cumulative scores.
            review_year_start_month: {
                type: Sequelize.SMALLINT,
                allowNull: false,
                defaultValue: 4
            },
            // Three weights even though customer feedback is parked: v1 sets it to
            // 0, and switching the factor on later is a config edit, not a migration.
            // A factor at weight 0 is OUT OF SCOPE, not missing — it is excluded
            // from the composite and from coverage rather than defaulting to 100.
            weight_system: {
                type: Sequelize.DECIMAL(5, 2),
                allowNull: false,
                defaultValue: 60
            },
            weight_lead: {
                type: Sequelize.DECIMAL(5, 2),
                allowNull: false,
                defaultValue: 40
            },
            weight_customer: {
                type: Sequelize.DECIMAL(5, 2),
                allowNull: false,
                defaultValue: 0
            },
            lead_template_id: {
                type: Sequelize.INTEGER,
                allowNull: true
            },
            // 'score_100' is the only shipped behaviour. The column exists so the
            // alternative ('redistribute') needs no migration if it is ever wanted.
            missing_factor_policy: {
                type: Sequelize.STRING(20),
                allowNull: false,
                defaultValue: 'score_100'
            },
            is_enabled: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false
            },
            created_by_user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            ...TIMESTAMPS(Sequelize)
        });

        await queryInterface.sequelize.query(`
            ALTER TABLE review_cycle_configs
              ADD CONSTRAINT review_cycle_configs_weights_sum_100
              CHECK (weight_system + weight_lead + weight_customer = 100);
        `);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('review_cycle_configs');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_review_cycle_configs_cadence";');
    }
};
