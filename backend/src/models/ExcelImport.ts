import {
    Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany,
} from 'sequelize-typescript';
import { Project } from './Project';
import { User } from './User';
import { ExcelWorkItem } from './ExcelWorkItem';
import { ExcelStatusHistory } from './ExcelStatusHistory';

@Table({ tableName: 'excel_imports', timestamps: true })
export class ExcelImport extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => Project)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'project_id' })
    projectId!: number;

    @BelongsTo(() => Project)
    project!: Project;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'uploaded_by' })
    uploadedBy?: number;

    @Column({ type: DataType.STRING(32), allowNull: false })
    template!: 'scrum' | 'kanban';

    @Column({ type: DataType.STRING(32), allowNull: false, defaultValue: 'strict' })
    mode!: 'strict' | 'best_effort';

    @Column({ type: DataType.STRING(32), allowNull: false, defaultValue: 'applied' })
    status!: 'pending' | 'applied' | 'rejected' | 'failed';

    /** Human-readable reason an import did not apply. Never a raw exception. */
    @Column({ type: DataType.TEXT, allowNull: true, field: 'error_message' })
    errorMessage?: string;

    @Column({ type: DataType.DATE, allowNull: true, field: 'failed_at' })
    failedAt?: Date;

    /** Absolute path to the retained copy of the uploaded file. */
    @Column({ type: DataType.STRING(1024), allowNull: true, field: 'storage_path' })
    storagePath?: string;

    @Column({ type: DataType.INTEGER, allowNull: true, field: 'file_size' })
    fileSize?: number;

    /** sha256 of the uploaded bytes, used to spot an identical re-upload. */
    @Column({ type: DataType.STRING(64), allowNull: true })
    checksum?: string;

    @Column({ type: DataType.STRING(128), allowNull: true, field: 'mime_type' })
    mimeType?: string;

    @Column({ type: DataType.DATEONLY, allowNull: true, field: 'report_date' })
    reportDate?: string;

    @Column({ type: DataType.DATEONLY, allowNull: true, field: 'period_start' })
    periodStart?: string;

    @Column({ type: DataType.DATEONLY, allowNull: true, field: 'period_end' })
    periodEnd?: string;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'row_count' })
    rowCount!: number;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'history_count' })
    historyCount!: number;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'has_history' })
    hasHistory!: boolean;

    @Column({ type: DataType.JSONB, allowNull: true, field: 'validation_report' })
    validationReport?: unknown;

    @Column({ type: DataType.STRING(512), allowNull: true, field: 'original_filename' })
    originalFilename?: string;

    /**
     * How this upload was folded into the projection. Replayed verbatim by rebuildProjection, so
     * the merged state can always be reconstructed from the ledger.
     */
    @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'merge', field: 'conflict_strategy' })
    conflictStrategy!: 'merge' | 'replace';

    /** Mapping version that parsed this file, so a later mapping change stays explainable. */
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'template_mapping_id' })
    templateMappingId?: number;

    @HasMany(() => ExcelWorkItem)
    items!: ExcelWorkItem[];

    @HasMany(() => ExcelStatusHistory)
    history!: ExcelStatusHistory[];

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'created_at' })
    createdAt!: Date;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'updated_at' })
    updatedAt!: Date;
}
