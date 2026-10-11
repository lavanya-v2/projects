import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Risk } from './Risk';
import { User } from './User';

@Table({
    tableName: 'risk_comments',
    timestamps: true
})
export class RiskComment extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER
    })
    id!: number;

    @ForeignKey(() => Risk)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'risk_id'
    })
    riskId!: number;

    @BelongsTo(() => Risk)
    risk!: Risk;

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
        type: DataType.TEXT,
        allowNull: false
    })
    comment!: string;

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

    // Set when the author edits their comment; drives the "(edited)" indicator.
    @Column({
        type: DataType.DATE,
        allowNull: true,
        field: 'edited_at'
    })
    editedAt!: Date | null;
}
