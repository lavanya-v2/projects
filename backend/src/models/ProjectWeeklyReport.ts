import { Table, Column, Model, DataType, ForeignKey, BelongsTo, Index } from 'sequelize-typescript';
import { Project } from './Project';

@Table({
    tableName: 'project_weekly_reports',
    timestamps: true,
    underscored: true
})
export class ProjectWeeklyReport extends Model {
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
        type: DataType.DATEONLY,
        allowNull: false,
        field: 'start_date'
    })
    startDate!: string;

    @Column({
        type: DataType.DATEONLY,
        allowNull: false,
        field: 'end_date'
    })
    endDate!: string;

    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'week_number'
    })
    weekNumber!: number;

    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    year!: number;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'executive_summary'
    })
    executiveSummary!: string;

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
        allowNull: false
    })
    status!: string;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'additional_notes'
    })
    additionalNotes!: string;

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
        allowNull: true,
        field: 'insights_stale_since'
    })
    insightsStaleSince?: Date;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'weekly_health_rationale',
        defaultValue: null
    })
    weeklyHealthRationale?: string | null;

    @Column({
        type: DataType.DATE,
        defaultValue: DataType.NOW,
        field: 'created_at'
    })
    createdAt!: Date;

    @Column({
        type: DataType.JSONB,
        field: 'team_members',
        defaultValue: []
    })
    teamMembers?: string[];

    @Column({
        type: DataType.JSONB,
        defaultValue: {}
    })
    metrics?: any;

    @Column({
        type: DataType.DATE,
        defaultValue: DataType.NOW,
        field: 'updated_at'
    })
    updatedAt!: Date;
}
