import {
    Table, Column, Model, DataType, ForeignKey, BelongsTo,
} from 'sequelize-typescript';
import { ExcelImport } from './ExcelImport';

@Table({ tableName: 'excel_status_history', timestamps: true })
export class ExcelStatusHistory extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => ExcelImport)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'import_id' })
    importId!: number;

    @BelongsTo(() => ExcelImport)
    import!: ExcelImport;

    @Column({ type: DataType.STRING(255), allowNull: false, field: 'ext_id' })
    extId!: string;

    @Column({ type: DataType.STRING(128), allowNull: true, field: 'from_status' })
    fromStatus?: string;

    @Column({ type: DataType.STRING(128), allowNull: false, field: 'to_status' })
    toStatus!: string;

    @Column({ type: DataType.DATE, allowNull: false, field: 'changed_on' })
    changedOn!: Date;

    @Column({ type: DataType.STRING(255), allowNull: true, field: 'changed_by_email' })
    changedByEmail?: string;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'created_at' })
    createdAt!: Date;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'updated_at' })
    updatedAt!: Date;
}
