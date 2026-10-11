import {
    Table, Column, Model, DataType, ForeignKey, BelongsTo,
} from 'sequelize-typescript';
import { ExcelImport } from './ExcelImport';

@Table({ tableName: 'excel_work_items', timestamps: true })
export class ExcelWorkItem extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => ExcelImport)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'import_id' })
    importId!: number;

    @BelongsTo(() => ExcelImport)
    import!: ExcelImport;

    @Column({ type: DataType.STRING(255), allowNull: false, field: 'ext_id' })
    extId!: string;

    @Column({ type: DataType.TEXT, allowNull: false })
    title!: string;

    @Column({ type: DataType.STRING(64), allowNull: false })
    type!: string;

    @Column({ type: DataType.STRING(128), allowNull: false })
    status!: string;

    @Column({ type: DataType.STRING(32), allowNull: true })
    priority?: string;

    @Column({ type: DataType.STRING(255), allowNull: false, field: 'assignee_email' })
    assigneeEmail!: string;

    @Column({ type: DataType.FLOAT, allowNull: true, field: 'story_points' })
    storyPoints?: number;

    @Column({ type: DataType.STRING(255), allowNull: true, field: 'sprint_name' })
    sprintName?: string;

    /** Normalised sprint identity; see sprintKey() in excelProjectionService. */
    @Column({ type: DataType.STRING(255), allowNull: false, field: 'sprint_key' })
    sprintKey!: string;

    @Column({ type: DataType.DATEONLY, allowNull: true, field: 'sprint_start' })
    sprintStart?: string;

    @Column({ type: DataType.DATEONLY, allowNull: true, field: 'sprint_end' })
    sprintEnd?: string;

    @Column({ type: DataType.DATE, allowNull: true, field: 'created_at_source' })
    createdAtSource!: Date;

    @Column({ type: DataType.DATE, allowNull: true, field: 'updated_at_source' })
    updatedAtSource!: Date;

    @Column({ type: DataType.DATE, allowNull: true, field: 'status_changed_on' })
    statusChangedOn?: Date;

    @Column({ type: DataType.DATE, allowNull: true, field: 'done_date' })
    doneDate?: Date;

    @Column({ type: DataType.STRING(255), allowNull: true, field: 'parent_ext_id' })
    parentExtId?: string;

    @Column({ type: DataType.ARRAY(DataType.TEXT), allowNull: true })
    labels?: string[];

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'created_at' })
    createdAt!: Date;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'updated_at' })
    updatedAt!: Date;
}
