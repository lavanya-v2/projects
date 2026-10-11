import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Project } from './Project';
import { ExcelImport } from './ExcelImport';

/**
 * Current state of every Excel ticket, merged across uploads -- the projection derived from the
 * excel_work_items ledger.
 *
 * Identity is (project_id, sprint_key, ext_id), enforced by a unique index, so re-uploading a file
 * updates tickets in place instead of duplicating them. Scoping by sprint (rather than project-wide
 * on ext_id) means a ticket that moves sprints stays present in its historical sprint.
 */
@Table({ tableName: 'excel_ticket_state', timestamps: true })
export class ExcelTicketState extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => Project)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'project_id' })
    projectId!: number;

    @BelongsTo(() => Project)
    project!: Project;

    /** Normalised sprint identity; see sprintKey() in excelProjectionService. */
    @Column({ type: DataType.STRING(255), allowNull: false, field: 'sprint_key' })
    sprintKey!: string;

    @Column({ type: DataType.STRING(255), allowNull: false, field: 'ext_id' })
    extId!: string;

    /** Most recent import that wrote this row. Nulled rather than cascaded when that import is deleted. */
    @ForeignKey(() => ExcelImport)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'last_import_id' })
    lastImportId?: number;

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

    /** Display form of the sprint, as written in the file. */
    @Column({ type: DataType.STRING(255), allowNull: true, field: 'sprint_name' })
    sprintName?: string;

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
