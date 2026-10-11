import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './User';
import { RetroItem } from './RetroItem';

/**
 * A comment on a retro item.
 *
 * Shape follows RiskComment (including editedAt driving the "(edited)"
 * indicator) with one deliberate divergence: `authorId` is NULLABLE here.
 * Comments carry the same anonymity guarantee as items — when isAnonymous, the
 * author is never written. Enforced by retro_item_comments_anon_author_chk.
 */
@Table({
    tableName: 'retro_item_comments',
    timestamps: true
})
export class RetroItemComment extends Model {
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

    /** NULL whenever isAnonymous. */
    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'author_id'
    })
    authorId!: number | null;

    @BelongsTo(() => User, 'author_id')
    author!: User | null;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_anonymous'
    })
    isAnonymous!: boolean;

    @Column({
        type: DataType.TEXT,
        allowNull: false
    })
    comment!: string;

    /** Set when the author edits; drives the "(edited)" indicator. */
    @Column({
        type: DataType.DATE,
        allowNull: true,
        field: 'edited_at'
    })
    editedAt!: Date | null;

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
