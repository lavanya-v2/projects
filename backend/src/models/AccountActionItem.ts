import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { Account } from './Account';
import { User } from './User';
import { ActionItemComment } from './ActionItemComment';

@Table({
    tableName: 'account_action_items',
    timestamps: true,
    underscored: true,
})
export class AccountActionItem extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER,
    })
    id!: number;

    @ForeignKey(() => Account)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'account_id',
    })
    accountId!: number;

    @BelongsTo(() => Account)
    account!: Account;

    @Column({
        type: DataType.STRING(500),
        allowNull: false,
    })
    title!: string;

    @Column({
        type: DataType.STRING(50),
        allowNull: false,
    })
    category!: string;

    @Column({
        type: DataType.STRING(255),
        allowNull: false,
    })
    owner!: string;

    @Column({
        type: DataType.STRING(20),
        allowNull: false,
        defaultValue: 'Open',
    })
    status!: string;

    @Column({
        type: DataType.DATEONLY,
        allowNull: true,
        field: 'due_date',
    })
    dueDate!: string | null;

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'created_by_id',
    })
    createdById!: number | null;

    @BelongsTo(() => User, 'created_by_id')
    createdBy!: User | null;

    @HasMany(() => ActionItemComment)
    comments!: ActionItemComment[];
}
