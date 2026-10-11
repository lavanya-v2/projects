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

module.exports = {
    async up(queryInterface, Sequelize) {
        // ---------------------------------------------------------------
        // retro_boards
        // ---------------------------------------------------------------
        await queryInterface.createTable('retro_boards', {
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
            title: {
                type: Sequelize.STRING(255),
                allowNull: false
            },
            meeting_date: {
                type: Sequelize.DATEONLY,
                allowNull: false
            },
            meeting_time: {
                type: Sequelize.TIME,
                allowNull: false
            },
            timezone: {
                type: Sequelize.STRING(64),
                allowNull: false,
                defaultValue: 'Asia/Kolkata'
            },
            status: {
                type: Sequelize.ENUM('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'),
                allowNull: false,
                defaultValue: 'DRAFT'
            },
            // Ordered lane definitions: [{ key, name, order, color }].
            // JSONB rather than a table, mirroring projects.lane_config — lanes are
            // 3-6 entries, always read with the board, never queried independently.
            lanes: {
                type: Sequelize.JSONB,
                allowNull: false
            },
            // NOT a bearer credential. Access is always re-derived from
            // user_permissions; this only keeps the deep link from being a
            // guessable sequential id.
            share_token: {
                type: Sequelize.UUID,
                allowNull: false,
                defaultValue: Sequelize.literal('gen_random_uuid()')
            },
            allow_anonymous: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: true
            },
            voting_enabled: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: true
            },
            votes_per_user: {
                type: Sequelize.SMALLINT,
                allowNull: false,
                defaultValue: 3
            },
            created_by_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'RESTRICT'
            },
            completed_at: {
                type: Sequelize.DATE,
                allowNull: true
            },
            ...TIMESTAMPS(Sequelize)
        });

        await queryInterface.addIndex('retro_boards', ['project_id']);
        await queryInterface.addIndex('retro_boards', ['project_id', 'meeting_date']);
        await queryInterface.addIndex('retro_boards', ['status']);
        await queryInterface.addIndex('retro_boards', ['share_token'], {
            unique: true,
            name: 'retro_boards_share_token_uq'
        });

        // ---------------------------------------------------------------
        // retro_items
        // ---------------------------------------------------------------
        await queryInterface.createTable('retro_items', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            board_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'retro_boards', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            lane_key: {
                type: Sequelize.STRING(40),
                allowNull: false
            },
            content: {
                type: Sequelize.TEXT,
                allowNull: false
            },
            is_anonymous: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false
            },
            // NULL by design when is_anonymous — the author is never written to
            // the database. Enforced below by retro_items_anon_author_chk.
            author_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            author_role_name: {
                type: Sequelize.STRING(20),
                allowNull: true
            },
            sort_order: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0
            },
            top_pick_rank: {
                type: Sequelize.SMALLINT,
                allowNull: true
            },
            converted_type: {
                type: Sequelize.ENUM('ACTION_ITEM', 'RISK'),
                allowNull: true
            },
            converted_ref_id: {
                type: Sequelize.INTEGER,
                allowNull: true
            },
            converted_at: {
                type: Sequelize.DATE,
                allowNull: true
            },
            converted_by_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            ...TIMESTAMPS(Sequelize)
        });

        await queryInterface.addIndex('retro_items', ['board_id', 'lane_key']);
        await queryInterface.addIndex('retro_items', ['board_id', 'sort_order']);
        await queryInterface.addIndex('retro_items', ['converted_type', 'converted_ref_id']);

        // The anonymity invariant, enforced by the database rather than by
        // Sequelize validation alone: raw queries and future migrations bypass
        // the model layer. This turns "we accidentally started recording the
        // author" into a failed insert instead of a silent privacy regression.
        await queryInterface.sequelize.query(`
            ALTER TABLE retro_items ADD CONSTRAINT retro_items_anon_author_chk
            CHECK ( (is_anonymous = true  AND author_id IS NULL AND author_role_name IS NULL)
                 OR (is_anonymous = false AND author_id IS NOT NULL) );
        `);

        await queryInterface.sequelize.query(`
            ALTER TABLE retro_items ADD CONSTRAINT retro_items_top_pick_rank_chk
            CHECK (top_pick_rank IS NULL OR top_pick_rank BETWEEN 1 AND 3);
        `);

        // "One item per rank per board" as a database invariant, which is what
        // lets top-3 be a column rather than a join table.
        await queryInterface.sequelize.query(`
            CREATE UNIQUE INDEX retro_items_board_top_pick_uq
            ON retro_items (board_id, top_pick_rank) WHERE top_pick_rank IS NOT NULL;
        `);

        // ---------------------------------------------------------------
        // retro_item_comments
        // ---------------------------------------------------------------
        await queryInterface.createTable('retro_item_comments', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            item_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'retro_items', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            // Nullable, unlike risk_comments.user_id — same anonymity rule as items.
            author_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            },
            is_anonymous: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false
            },
            comment: {
                type: Sequelize.TEXT,
                allowNull: false
            },
            edited_at: {
                type: Sequelize.DATE,
                allowNull: true
            },
            ...TIMESTAMPS(Sequelize)
        });

        await queryInterface.addIndex('retro_item_comments', ['item_id', 'created_at']);

        await queryInterface.sequelize.query(`
            ALTER TABLE retro_item_comments ADD CONSTRAINT retro_item_comments_anon_author_chk
            CHECK ( (is_anonymous = true  AND author_id IS NULL)
                 OR (is_anonymous = false AND author_id IS NOT NULL) );
        `);

        // ---------------------------------------------------------------
        // retro_item_votes
        //
        // Deliberate asymmetry with items: votes DO store user_id, because
        // one-vote-per-item and the per-user vote budget are unenforceable
        // otherwise. The serializer never returns a voter list — only
        // voteCount and the requester's own hasVoted.
        // ---------------------------------------------------------------
        await queryInterface.createTable('retro_item_votes', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            item_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'retro_items', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            }
        });

        await queryInterface.addIndex('retro_item_votes', ['item_id']);
        await queryInterface.addIndex('retro_item_votes', ['item_id', 'user_id'], {
            unique: true,
            name: 'retro_item_votes_item_user_uq'
        });

        // ---------------------------------------------------------------
        // retro_board_participants
        //
        // Records THAT you attended, never WHAT you wrote.
        // ---------------------------------------------------------------
        await queryInterface.createTable('retro_board_participants', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            board_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'retro_boards', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            first_joined_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            },
            last_seen_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            }
        });

        await queryInterface.addIndex('retro_board_participants', ['board_id', 'user_id'], {
            unique: true,
            name: 'retro_board_participants_board_user_uq'
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('retro_board_participants');
        await queryInterface.dropTable('retro_item_votes');
        await queryInterface.dropTable('retro_item_comments');
        await queryInterface.dropTable('retro_items');
        await queryInterface.dropTable('retro_boards');
        // Drop ENUM types created by Sequelize
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_retro_boards_status";');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_retro_items_converted_type";');
    }
};
