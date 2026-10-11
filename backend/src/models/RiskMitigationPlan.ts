import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Risk } from './Risk';

@Table({
    tableName: 'risk_mitigation_plans',
    timestamps: true
})
export class RiskMitigationPlan extends Model {
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

    @Column({
        type: DataType.TEXT,
        allowNull: false
    })
    description!: string;

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
