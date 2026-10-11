import { Table, Column, Model, DataType } from 'sequelize-typescript';

@Table({ tableName: 'notification_templates', timestamps: true })
export class NotificationTemplate extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @Column({ type: DataType.STRING(100), allowNull: false, unique: true })
    code!: string;

    @Column({ type: DataType.STRING(255), allowNull: false })
    name!: string;

    @Column({ type: DataType.STRING(32), allowNull: false })
    transport!: string;

    @Column({ type: DataType.TEXT, allowNull: true, field: 'subject_template' })
    subjectTemplate!: string | null;

    @Column({ type: DataType.TEXT, allowNull: false, field: 'body_template' })
    bodyTemplate!: string;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' })
    isActive!: boolean;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'created_at' })
    createdAt!: Date;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'updated_at' })
    updatedAt!: Date;
}
