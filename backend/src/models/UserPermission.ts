import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './User';
import { Account } from './Account';
import { Project } from './Project';
import { Program } from './Program';



@Table({
    tableName: 'user_permissions',
    timestamps: true
})
export class UserPermission extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER
    })
    id!: number;

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'user_id'
    })
    userId!: number;

    @BelongsTo(() => User)
    user!: User;

    @ForeignKey(() => Account)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'account_id'
    })
    accountId!: number | null;

    @BelongsTo(() => Account)
    account!: Account;

    @ForeignKey(() => Program)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'program_id'
    })
    programId!: number | null;

    @BelongsTo(() => Program)
    program?: Program;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_primary'
    })
    isPrimary!: boolean;

    @Column({
        type: DataType.ARRAY(DataType.INTEGER),
        allowNull: true,
        defaultValue: [],
        field: 'project_ids'
    })
    projectIds!: number[];

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
