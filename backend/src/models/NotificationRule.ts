import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { NotificationEvent } from './NotificationEvent';
import { NotificationTemplate } from './NotificationTemplate';

export interface RecipientsConfig {
    roles?: string[];
    scope?: 'project' | 'account' | 'global';
}

export interface CcConfig {
    emails?: string[];
}

export interface ScopeConfig {
    projectIds?: number[];
    accountIds?: number[];
}

@Table({ tableName: 'notification_rules', timestamps: true })
export class NotificationRule extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => NotificationEvent)
    @Column({ type: DataType.STRING(100), allowNull: false, field: 'event_code' })
    eventCode!: string;

    @BelongsTo(() => NotificationEvent)
    event!: NotificationEvent;

    @ForeignKey(() => NotificationTemplate)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'template_id' })
    templateId!: number;

    @BelongsTo(() => NotificationTemplate)
    template!: NotificationTemplate;

    @Column({ type: DataType.STRING(32), allowNull: false })
    transport!: string;

    @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {}, field: 'recipients_config' })
    recipientsConfig!: RecipientsConfig;

    @Column({ type: DataType.JSONB, allowNull: true, field: 'cc_config' })
    ccConfig!: CcConfig | null;

    @Column({ type: DataType.JSONB, allowNull: true, field: 'scope_config' })
    scopeConfig!: ScopeConfig | null;

    @Column({ type: DataType.INTEGER, allowNull: true, field: 'coalesce_window_seconds' })
    coalesceWindowSeconds!: number | null;

    @Column({ type: DataType.JSONB, allowNull: true, field: 'coalesce_key_config' })
    coalesceKeyConfig!: string[] | null;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' })
    isActive!: boolean;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
    priority!: number;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'created_at' })
    createdAt!: Date;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'updated_at' })
    updatedAt!: Date;
}
