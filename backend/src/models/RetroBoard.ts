import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { User } from './User';
import { Project } from './Project';
import { RetroItem } from './RetroItem';
import { RetroBoardParticipant } from './RetroBoardParticipant';

export type RetroBoardStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';

/**
 * A single lane on a retro board. Stored as JSONB on the board rather than in
 * its own table (same call as projects.lane_config): lanes are 3-6 entries,
 * always read together with the board, and never queried independently.
 *
 * `key` is immutable once created — retro_items.lane_key references it and
 * there is no FK to cascade a rename. `name` is freely editable.
 */
export interface RetroLane {
    key: string;
    name: string;
    order: number;
    color: string;
}

@Table({
    tableName: 'retro_boards',
    timestamps: true
})
export class RetroBoard extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER
    })
    id!: number;

    @ForeignKey(() => Project)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'project_id'
    })
    projectId!: number;

    @BelongsTo(() => Project)
    project!: Project;

    @Column({
        type: DataType.STRING(255),
        allowNull: false
    })
    title!: string;

    @Column({
        type: DataType.DATEONLY,
        allowNull: false,
        field: 'meeting_date'
    })
    meetingDate!: string;

    @Column({
        type: DataType.TIME,
        allowNull: false,
        field: 'meeting_time'
    })
    meetingTime!: string;

    @Column({
        type: DataType.STRING(64),
        allowNull: false,
        defaultValue: 'Asia/Kolkata'
    })
    timezone!: string;

    @Column({
        type: DataType.ENUM('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'),
        allowNull: false,
        defaultValue: 'DRAFT'
    })
    status!: RetroBoardStatus;

    @Column({
        type: DataType.JSONB,
        allowNull: false
    })
    lanes!: RetroLane[];

    /**
     * Deep-link token. NOT a bearer credential — every request still re-derives
     * access from user_permissions. It exists only so the board URL is not a
     * guessable sequential id.
     */
    // defaultValue is set here as well as in the migration: Sequelize includes
    // the column in the INSERT and validates it client-side, so the database's
    // gen_random_uuid() default would never get a chance to fire.
    @Column({
        type: DataType.UUID,
        allowNull: false,
        defaultValue: DataType.UUIDV4,
        field: 'share_token'
    })
    shareToken!: string;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'allow_anonymous'
    })
    allowAnonymous!: boolean;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'voting_enabled'
    })
    votingEnabled!: boolean;

    /** 0 means unlimited. */
    @Column({
        type: DataType.SMALLINT,
        allowNull: false,
        defaultValue: 3,
        field: 'votes_per_user'
    })
    votesPerUser!: number;

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'created_by_id'
    })
    createdById!: number;

    @BelongsTo(() => User, 'created_by_id')
    creator!: User;

    @Column({
        type: DataType.DATE,
        allowNull: true,
        field: 'completed_at'
    })
    completedAt!: Date | null;

    @HasMany(() => RetroItem)
    items!: RetroItem[];

    @HasMany(() => RetroBoardParticipant)
    participants!: RetroBoardParticipant[];

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
