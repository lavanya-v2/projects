import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { ProjectActionItem } from './ProjectActionItem';
import { User } from './User';
import { AccountActionItem } from './AccountActionItem';
import { ProgramActionItem } from './ProgramActionItem';

@Table({
    tableName: 'action_item_status_history',
    timestamps: false,
    underscored: true,
})
export class ActionItemStatusHistory extends Model {
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

    @Column({
        type: DataType.STRING(20),
        allowNull: true,
        field: 'from_status',
    })
    fromStatus!: string | null;

    @Column({
        type: DataType.STRING(20),
        allowNull: false,
        field: 'to_status',
    })
    toStatus!: string;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
    })
    note!: string | null;

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'changed_by_id',
    })
    changedById!: number | null;

    @BelongsTo(() => User, 'changed_by_id')
    changedBy!: User | null;

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW,
        field: 'changed_at',
    })
    changedAt!: Date;
}
