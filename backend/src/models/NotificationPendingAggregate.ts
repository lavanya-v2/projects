import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { NotificationRule } from './NotificationRule';

export type AggregateStatus = 'PENDING' | 'FLUSHED';

@Table({ tableName: 'notification_pending_aggregates', timestamps: true })
export class NotificationPendingAggregate extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => NotificationRule)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'rule_id' })
    ruleId!: number;

    @BelongsTo(() => NotificationRule)
    rule!: NotificationRule;

    @Column({ type: DataType.STRING(255), allowNull: false, field: 'coalesce_key' })
    coalesceKey!: string;

    @Column({ type: DataType.JSONB, allowNull: false, defaultValue: [] })
    events!: Array<Record<string, unknown>>;

    @Column({ type: DataType.DATE, allowNull: false, field: 'flush_at' })
    flushAt!: Date;

    @Column({ type: DataType.STRING(32), allowNull: false, defaultValue: 'PENDING' })
    status!: AggregateStatus;

    @Column({ type: DataType.STRING(255), allowNull: true, field: 'job_id' })
    jobId!: string | null;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'created_at' })
    createdAt!: Date;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'updated_at' })
    updatedAt!: Date;
}
