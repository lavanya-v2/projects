import { Table, Column, Model, DataType } from 'sequelize-typescript';

export type NotificationLogStatus = 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';

@Table({ tableName: 'notification_logs', timestamps: true })
export class NotificationLog extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @Column({ type: DataType.STRING(100), allowNull: false, field: 'event_code' })
    eventCode!: string;

    @Column({ type: DataType.INTEGER, allowNull: true, field: 'rule_id' })
    ruleId!: number | null;

    @Column({ type: DataType.INTEGER, allowNull: true, field: 'template_id' })
    templateId!: number | null;

    @Column({ type: DataType.STRING(32), allowNull: false })
    transport!: string;

    @Column({ type: DataType.JSONB, allowNull: false, defaultValue: [] })
    recipients!: string[];

    @Column({ type: DataType.JSONB, allowNull: true })
    cc!: string[] | null;

    @Column({ type: DataType.TEXT, allowNull: true })
    subject!: string | null;

    @Column({ type: DataType.TEXT, allowNull: true })
    body!: string | null;

    @Column({ type: DataType.JSONB, allowNull: true, field: 'payload_snapshot' })
    payloadSnapshot!: unknown;

    @Column({ type: DataType.STRING(32), allowNull: false, defaultValue: 'QUEUED' })
    status!: NotificationLogStatus;

    @Column({ type: DataType.TEXT, allowNull: true })
    error!: string | null;

    @Column({ type: DataType.INTEGER, allowNull: true, field: 'project_id' })
    projectId!: number | null;

    @Column({ type: DataType.INTEGER, allowNull: true, field: 'account_id' })
    accountId!: number | null;

    @Column({ type: DataType.STRING(255), allowNull: true, field: 'job_id' })
    jobId!: string | null;

    @Column({ type: DataType.DATE, allowNull: true, field: 'sent_at' })
    sentAt!: Date | null;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'created_at' })
    createdAt!: Date;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'updated_at' })
    updatedAt!: Date;
}
