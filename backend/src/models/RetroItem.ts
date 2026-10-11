import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { User } from './User';
import { RetroBoard } from './RetroBoard';
import { RetroItemComment } from './RetroItemComment';
import { RetroItemVote } from './RetroItemVote';

export type RetroConvertedType = 'ACTION_ITEM' | 'RISK';

/** What became of an agreed point, as judged by a later retro. */
export type RetroOutcome = 'DONE' | 'STILL_OPEN' | 'DROPPED';

/**
 * A card on a retro board.
 *
 * ANONYMITY INVARIANT: when `isAnonymous` is true, `authorId` and
 * `authorRoleName` are NULL — the author is never written to the database, not
 * merely hidden at read time. This is enforced by the DB CHECK constraint
 * `retro_items_anon_author_chk`, because raw queries and future migrations
 * bypass model-level validation.
 *
 * The direct consequence, which the UI must own rather than work around: an
 * anonymous item cannot be edited or deleted by its author afterwards, because
 * there is no author to compare the requester against.
 */
@Table({
    tableName: 'retro_items',
    timestamps: true
})
export class RetroItem extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER
    })
    id!: number;

    @ForeignKey(() => RetroBoard)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'board_id'
    })
    boardId!: number;

    @BelongsTo(() => RetroBoard)
    board!: RetroBoard;

    /** References RetroBoard.lanes[].key. No FK — validated in the service layer. */
    @Column({
        type: DataType.STRING(40),
        allowNull: false,
        field: 'lane_key'
    })
    laneKey!: string;

    @Column({
        type: DataType.TEXT,
        allowNull: false
    })
    content!: string;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_anonymous'
    })
    isAnonymous!: boolean;

    /** NULL whenever isAnonymous. See the class docblock. */
    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'author_id'
    })
    authorId!: number | null;

    @BelongsTo(() => User, 'author_id')
    author!: User | null;

    /** Role snapshot for permission resolution. NULL whenever isAnonymous. */
    @Column({
        type: DataType.STRING(20),
        allowNull: true,
        field: 'author_role_name'
    })
    authorRoleName!: string | null;

    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'sort_order'
    })
    sortOrder!: number;

    /**
     * 1..3 for the agreed top picks, NULL otherwise. A partial unique index on
     * (board_id, top_pick_rank) makes "one item per rank per board" a database
     * invariant, which is why this is a column and not a join table.
     */
    @Column({
        type: DataType.SMALLINT,
        allowNull: true,
        field: 'top_pick_rank'
    })
    topPickRank!: number | null;

    @Column({
        type: DataType.ENUM('ACTION_ITEM', 'RISK'),
        allowNull: true,
        field: 'converted_type'
    })
    convertedType!: RetroConvertedType | null;

    /** Id in project_action_items or risks, depending on convertedType. */
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'converted_ref_id'
    })
    convertedRefId!: number | null;

    @Column({
        type: DataType.DATE,
        allowNull: true,
        field: 'converted_at'
    })
    convertedAt!: Date | null;

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'converted_by_id'
    })
    convertedById!: number | null;

    @BelongsTo(() => User, 'converted_by_id')
    convertedBy!: User | null;

    /**
     * What actually happened to this agreed point, recorded by a LATER retro.
     *
     * NULL means "not yet reviewed". Only meaningful on items that hold a
     * topPickRank — outcomes track commitments, not every card, which the
     * service enforces.
     *
     * Writing this is the second deliberate exception to the completed-board
     * freeze (conversion is the first): a frozen board's content stays exactly
     * as agreed, but a subsequent retro may annotate what came of it.
     */
    @Column({
        type: DataType.ENUM('DONE', 'STILL_OPEN', 'DROPPED'),
        allowNull: true
    })
    outcome!: RetroOutcome | null;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'outcome_note'
    })
    outcomeNote!: string | null;

    @Column({
        type: DataType.DATE,
        allowNull: true,
        field: 'outcome_at'
    })
    outcomeAt!: Date | null;

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'outcome_by_id'
    })
    outcomeById!: number | null;

    @BelongsTo(() => User, 'outcome_by_id')
    outcomeBy!: User | null;

    /** The later retro in which this point was reviewed — the audit chain. */
    @ForeignKey(() => RetroBoard)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'outcome_reviewed_in_board_id'
    })
    outcomeReviewedInBoardId!: number | null;

    @HasMany(() => RetroItemComment, 'item_id')
    comments!: RetroItemComment[];

    @HasMany(() => RetroItemVote, 'item_id')
    votes!: RetroItemVote[];

    @Column({
        type: DataType.DATE,
        defaultValue: DataType.NOW,
        field: 'created_at'
    })
    createdAt!: Date;

    @Column({
        type: DataType.DATE,
        defaultValue: DataType.NOW,
        field: 'updated_at'
    })
    updatedAt!: Date;
}
