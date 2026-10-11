import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './User';
import { RetroItem } from './RetroItem';

/**
 * A vote on a retro item.
 *
 * Deliberate asymmetry with RetroItem, worth stating plainly: votes DO store
 * userId. One-vote-per-user-per-item and the per-board vote budget are simply
 * unenforceable without it.
 *
 * Mitigation is at the serialization layer, not by convention: the API returns
 * only `voteCount` and the requester's own `hasVoted`, never a voter list. So
 * voting on your own anonymous item does not de-anonymise you to other users —
 * but it does to anyone with direct database access. That residual exposure is
 * accepted; the alternative (an unlinked counter plus a per-board budget table)
 * loses idempotent toggle-off.
 */
@Table({
    tableName: 'retro_item_votes',
    timestamps: false
})
export class RetroItemVote extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER
    })
    id!: number;

    @ForeignKey(() => RetroItem)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'item_id'
    })
    itemId!: number;

    @BelongsTo(() => RetroItem)
    item!: RetroItem;

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
        field: 'created_at'
    })
    createdAt!: Date;
}
