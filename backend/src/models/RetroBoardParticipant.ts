import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './User';
import { RetroBoard } from './RetroBoard';

/**
 * Attendance record for a retro board.
 *
 * Records THAT a user attended, never WHAT they wrote — so it coexists with the
 * anonymity guarantee. Drives the PDF attendee list and presence avatars.
 *
 * Note the inherent limit this does not solve: in a three-person retro, an
 * anonymous item is one-in-three by arithmetic. That is a property of small
 * anonymous groups, not of this table; the UI says so rather than implying a
 * stronger guarantee than exists.
 */
@Table({
    tableName: 'retro_board_participants',
    timestamps: false
})
export class RetroBoardParticipant extends Model {
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

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'user_id'
    })
    userId!: number;

    @BelongsTo(() => User)
    user!: User;

    @Column({
        type: DataType.DATE,
        defaultValue: DataType.NOW,
        field: 'first_joined_at'
    })
    firstJoinedAt!: Date;

    @Column({
        type: DataType.DATE,
        defaultValue: DataType.NOW,
        field: 'last_seen_at'
    })
    lastSeenAt!: Date;
}
