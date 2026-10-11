import { Table, Column, Model, DataType } from 'sequelize-typescript';

@Table({ tableName: 'notification_events', timestamps: true })
export class NotificationEvent extends Model {
    @Column({ primaryKey: true, type: DataType.STRING(100), allowNull: false })
    code!: string;

    @Column({ type: DataType.TEXT, allowNull: true })
    description!: string | null;

    @Column({ type: DataType.JSONB, allowNull: true, field: 'payload_schema' })
    payloadSchema!: Record<string, unknown> | null;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' })
    isActive!: boolean;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'created_at' })
    createdAt!: Date;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'updated_at' })
    updatedAt!: Date;
}
