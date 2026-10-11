import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Project } from './Project';

@Table({
    tableName: 'monthly_project_reports',
    timestamps: true,
    underscored: true
})
export class MonthlyProjectReport extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER
    })
    id!: number;

    @ForeignKey(() => Project)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'project_id'
    })
    projectId!: number;

    @BelongsTo(() => Project)
    project!: Project;

    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    month!: number;

    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    year!: number;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'work_summary'
    })
    workSummary!: string;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    risks!: string;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    achievements!: string;

    @Column({
        type: DataType.STRING(50),
        allowNull: true
    })
    status!: string;

    /**
     * Deterministic rationale for `status` (Phase 3 of the RAG-reliability plan) — a
     * rollupHealth summary over this month's ProjectWeeklyReport statuses, mirroring
     * `weeklyHealthRationale` on ProjectWeeklyReport. AI no longer sets `status` directly.
     */
    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'monthly_health_rationale',
        defaultValue: null
    })
    monthlyHealthRationale?: string | null;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'manager_insights'
    })
    managerInsights?: string;

    @Column({ type: DataType.INTEGER, allowNull: true, field: 'insights_author_id' })
    insightsAuthorId?: number;

    @Column({ type: DataType.STRING(200), allowNull: true, field: 'insights_author_name' })
    insightsAuthorName?: string;

    @Column({ type: DataType.JSONB, allowNull: true, field: 'team_notes' })
    teamNotes?: Array<{ userId: number; name: string; text: string; timestamp: string }>;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'original_executive_summary'
    })
    originalExecutiveSummary?: string;

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
