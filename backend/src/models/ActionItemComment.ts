import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { ProjectActionItem } from './ProjectActionItem';
import { AccountActionItem } from './AccountActionItem';
import { ProgramActionItem } from './ProgramActionItem';
import { User } from './User';

@Table({
    tableName: 'action_item_comments',
    timestamps: true,
    underscored: true,
})
export class ActionItemComment extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER,
    })
    id!: number;

    @ForeignKey(() => ProjectActionItem)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'action_item_id',
    })
    actionItemId!: number | null;

    @BelongsTo(() => ProjectActionItem)
    actionItem!: ProjectActionItem | null;

    @ForeignKey(() => AccountActionItem)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'account_action_item_id',
    })
    accountActionItemId!: number | null;

    @BelongsTo(() => AccountActionItem)
    accountActionItem!: AccountActionItem | null;

    @ForeignKey(() => ProgramActionItem)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'program_action_item_id',
    })
    programActionItemId!: number | null;

    @BelongsTo(() => ProgramActionItem)
    programActionItem!: ProgramActionItem | null;

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'user_id',
    })
    userId!: number | null;

    @BelongsTo(() => User)
    user!: User | null;

    @Column({
        type: DataType.TEXT,
        allowNull: false,
    })
    content!: string;

    // Set when the author edits their comment; drives the "(edited)" indicator.
    @Column({
        type: DataType.DATE,
        allowNull: true,
        field: 'edited_at',
    })
    editedAt!: Date | null;
}
