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
 * review_cycle_participants — who is in scope, and who reviews them.
 *
 * This table exists because the codebase has no project_members table and no
 * projects.lead_id: team membership lives in account_team_members with a
 * free-text role, and "a lead's team" is otherwise only derivable by intersecting
 * user_permissions.project_ids. Neither can say who was accountable for reviewing
 * whom, which an HR artefact must state.
 *
 * Frozen at cycle open. People join and leave mid-quarter; a review must record
 * exactly who was in scope at the time, not who is on the roster today.
 *
 * `reviewer_user_id` is assigned PER PERSON rather than derived per project,
 * because a member spanning eight projects still gets exactly one reviewer.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('review_cycle_participants', {
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
            // 'developer' | 'qa' | 'other' — the cycle's DOMINANT category by
            // volume. A tech lead who codes one sprint and tests the next would
            // otherwise flip formula mid-period.
            member_category: {
                type: Sequelize.STRING(20),
                allowNull: false,
                defaultValue: 'developer'
            },
            reviewer_user_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            // Which in-scope projects fed this person's score. Needed to explain a
            // number that aggregates across several.
            contributing_project_ids: {
                type: Sequelize.ARRAY(Sequelize.INTEGER),
                allowNull: false,
                defaultValue: []
            },
            is_excluded: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false
            },
            exclusion_reason: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            // Roster role/source as it stood at open, for audit.
            roster_snapshot: {
                type: Sequelize.JSONB,
                allowNull: false,
                defaultValue: {}
            },
            ...TIMESTAMPS(Sequelize)
        });

        await queryInterface.addIndex('review_cycle_participants', ['review_cycle_id', 'team_member_id'], {
            name: 'review_cycle_participants_cycle_member_unique',
            unique: true
        });
        // "What do I have to review this cycle?" — the lead's workspace query.
        await queryInterface.addIndex('review_cycle_participants', ['reviewer_user_id'], {
            name: 'review_cycle_participants_reviewer_idx'
        });
        await queryInterface.addIndex('review_cycle_participants', ['team_member_id'], {
            name: 'review_cycle_participants_member_idx'
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('review_cycle_participants');
    }
};
