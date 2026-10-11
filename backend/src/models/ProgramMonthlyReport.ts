import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Program } from './Program';
import { Account } from './Account';

@Table({
    tableName: 'program_monthly_reports',
    timestamps: true,
    underscored: true
})
export class ProgramMonthlyReport extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER
    })
    id!: number;

    @ForeignKey(() => Program)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'program_id'
    })
    programId!: number;

    @BelongsTo(() => Program)
    program!: Program;

    @ForeignKey(() => Account)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'account_id'
    })
    accountId!: number;

    @BelongsTo(() => Account)
    account!: Account;

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
        allowNull: true
    })
    summary?: string;

    @Column({
        type: DataType.STRING,
        allowNull: true
    })
    health?: string;

    @Column({
        type: DataType.JSONB,
        allowNull: true,
        defaultValue: { summary: '', items: [] }
    })
    risks!: { summary: string; items: string[] };

    @Column({
        type: DataType.JSONB,
        allowNull: true,
        defaultValue: [],
        field: 'key_accomplishments'
    })
    keyAccomplishments!: string[];

    @Column({
        type: DataType.JSONB,
        allowNull: true,
        defaultValue: [],
        field: 'red_projects'
    })
    redProjects!: string[];

    @Column({
        type: DataType.JSONB,
        allowNull: true,
        defaultValue: [],
        field: 'projects_included'
    })
    projectsIncluded!: string[];

    @Column({
        type: DataType.JSONB,
        allowNull: true,
        defaultValue: [],
        field: 'projects_missing'
    })
    projectsMissing!: string[];

    @Column({
        type: DataType.JSONB,
        allowNull: true,
        defaultValue: [],
        field: 'action_items'
    })
    actionItems!: string[];

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'manager_insights'
    })
    managerInsights?: string;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'original_executive_summary'
    })
    originalExecutiveSummary?: string;

    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'insights_author_id'
    })
    insightsAuthorId?: number;

    @Column({
        type: DataType.STRING(200),
        allowNull: true,
        field: 'insights_author_name'
    })
    insightsAuthorName?: string;

    @Column({
        type: DataType.JSONB,
        allowNull: true,
        field: 'team_notes'
    })
    teamNotes?: Array<{ userId: number; name: string; text: string; timestamp: string }>;

    @Column({
        type: DataType.JSONB,
        allowNull: true,
        defaultValue: []
    })
    annexure?: { title: string; points: string[] }[];

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'file_path'
    })
    filePath?: string;

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
