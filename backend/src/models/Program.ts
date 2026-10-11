import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { Account } from './Account';
import { Project } from './Project';

@Table({
    tableName: 'programs',
    timestamps: true,
    underscored: true
})
export class Program extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER
    })
    id!: number;

    @ForeignKey(() => Account)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'account_id'
    })
    accountId!: number;

    @BelongsTo(() => Account)
    account!: Account;

    @Column({
        type: DataType.STRING(200),
        allowNull: false
    })
    name!: string;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    description?: string;

    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'red_threshold_percentage'
    })
    redThresholdPercentage?: number;

    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'created_by'
    })
    createdBy?: number;

    @HasMany(() => Project)
    projects!: Project[];

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
