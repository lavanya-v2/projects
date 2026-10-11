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
 * Competency templates — what a lead is asked to rate.
 *
 * VERSIONED, never edited in place once active. A published review must always be
 * readable against the exact question set it was answered under; editing a live
 * template would silently change what a historical rating meant. Editing an
 * active template therefore creates a new version and retires the old one, and
 * `lead_reviews.template_id` pins the version actually used.
 *
 * Items are ROWS, not a JSONB blob. The editor UI copies the CustomSections idiom,
 * but storage cannot: a rating has to FK to a competency so that "show me this
 * person's Code Quality across four cycles" is SQL rather than app-side string
 * matching against labels that may have been reworded.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('competency_templates', {
            id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
            name: { type: Sequelize.STRING(255), allowNull: false },
            description: { type: Sequelize.TEXT, allowNull: true },

            // Where the template applies. Narrower scope wins when resolving.
            scope: {
                type: Sequelize.ENUM('global', 'account', 'project'),
                allowNull: false,
                defaultValue: 'account'
            },
            account_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'accounts', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'projects', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },

            version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
            // Chain back to the version this one replaced, so a reviewer can follow
            // how the question set evolved.
            parent_template_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'competency_templates', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            status: {
                type: Sequelize.ENUM('draft', 'active', 'retired'),
                allowNull: false,
                defaultValue: 'draft'
            },

            rating_scale_min: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 1 },
            rating_scale_max: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 5 },
            // Optional labels for each point on the scale, e.g. 1 = "Needs support".
            // A bare number means different things to different leads; naming the
            // points is what makes ratings comparable across reviewers.
            rating_scale_labels: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },

            /** 'developer' | 'qa' | null = applies to everyone. */
            applies_to_category: { type: Sequelize.STRING(20), allowNull: true },

            created_by_user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            ...TIMESTAMPS(Sequelize)
        });

        await queryInterface.addIndex('competency_templates', ['scope', 'account_id', 'project_id', 'status'], {
            name: 'competency_templates_scope_status_idx'
        });

        await queryInterface.sequelize.query(`
            ALTER TABLE competency_templates
              ADD CONSTRAINT competency_templates_scale_ordered
              CHECK (rating_scale_max > rating_scale_min);
        `);

        // A scoped template must name its scope target, and a global one must not.
        await queryInterface.sequelize.query(`
            ALTER TABLE competency_templates
              ADD CONSTRAINT competency_templates_scope_target CHECK (
                (scope = 'global'  AND account_id IS NULL AND project_id IS NULL) OR
                (scope = 'account' AND account_id IS NOT NULL AND project_id IS NULL) OR
                (scope = 'project' AND project_id IS NOT NULL)
              );
        `);

        // ── Items ────────────────────────────────────────────────────────────
        await queryInterface.createTable('competency_template_items', {
            id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
            template_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'competency_templates', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            /** Grouping heading in the form, e.g. 'Delivery', 'Collaboration'. */
            section: { type: Sequelize.STRING(100), allowNull: true },
            /** Stable machine key. Survives relabelling, so trends stay joinable. */
            key: { type: Sequelize.STRING(64), allowNull: false },
            label: { type: Sequelize.STRING(255), allowNull: false },
            description: { type: Sequelize.TEXT, allowNull: true },
            input_type: {
                type: Sequelize.ENUM('rating', 'text', 'boolean'),
                allowNull: false,
                defaultValue: 'rating'
            },
            /** Relative weight within the lead factor. Only meaningful for ratings. */
            weight: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 1 },
            is_required: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
            /**
             * Whether a written justification accompanies the answer. Defaults true
             * and is enforced unconditionally for ratings: a bare number cannot be
             * defended in an appraisal conversation.
             */
            requires_comment: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
            sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
            ...TIMESTAMPS(Sequelize)
        });

        await queryInterface.addIndex('competency_template_items', ['template_id', 'key'], {
            name: 'competency_template_items_template_key_unique',
            unique: true
        });
        await queryInterface.addIndex('competency_template_items', ['template_id', 'sort_order'], {
            name: 'competency_template_items_order_idx'
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('competency_template_items');
        await queryInterface.dropTable('competency_templates');
        for (const t of [
            'enum_competency_template_items_input_type',
            'enum_competency_templates_scope',
            'enum_competency_templates_status'
        ]) {
            await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${t}";`);
        }
    }
};
