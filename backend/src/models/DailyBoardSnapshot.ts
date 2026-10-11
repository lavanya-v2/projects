import { Table, Column, Model, DataType, Index, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Project } from './Project';
import { Account } from './Account';

@Table({
    tableName: 'daily_board_snapshots',
    timestamps: false
})
export class DailyBoardSnapshot extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true
    })
    id!: number;

    @Column({
        type: DataType.DATEONLY,
        allowNull: false,
        field: 'date'
    })
    date!: string;

    @Column({
        allowNull: false,
        field: 'board_id'
    })
    boardId!: number;

    @ForeignKey(() => Project)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'project_id'
    })
    projectId!: number;

    @BelongsTo(() => Project)
    project!: Project;

    @ForeignKey(() => Account)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'account_id'
    })
    accountId!: number;

    @BelongsTo(() => Account)
    account!: Account;

    @Column({
        type: DataType.STRING(255),
        field: 'board_name'
    })
    boardName?: string;

    @Column({
        field: 'total_tickets'
    })
    totalTickets?: number;

    @Column({
        type: DataType.JSONB,
        field: 'status_counts'
    })
    statusCounts?: Record<string, number>;

    @Column({
        type: DataType.JSONB,
        field: 'blocked_tickets'
    })
    blockedTickets?: Array<any>;

    @Column({
        type: DataType.TEXT,
        field: 'work_summary'
    })
    workSummary?: string;

    @Column({
        type: DataType.JSONB,
        allowNull: true,
        field: 'considered_jira_ids',
        defaultValue: []
    })
    consideredJiraIds?: string[];

    @Column({
        type: DataType.STRING(255),
        field: 'overall_health'
    })
    overallHealth?: string;

    @Column({
        type: DataType.JSONB,
        field: 'ticket_keys'
    })
    ticketKeys?: Record<string, string>;

    @Column({
        type: DataType.STRING(255),
        field: 'project_name'
    })
    projectName?: string;

    @Column({
        type: DataType.TEXT,
        field: 'executive_summary'
    })
    executiveSummary?: string;

    @Column({
        type: DataType.TEXT,
        field: 'executive_risks'
    })
    executiveRisks?: string;

    @Column({
        type: DataType.TEXT,
        field: 'executive_plan'
    })
    executivePlan?: string;

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
        type: DataType.STRING(50),
        allowNull: true,
        field: 'insights_health'
    })
    insightsHealth?: string;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'insights_health_reason'
    })
    insightsHealthReason?: string;

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
        field: 'sprint_burndown'
    })
    sprintBurndown?: {
        sprintName: string;
        startDate: string;
        endDate: string;
        // Days
        daysTotal: number;
        daysElapsed: number;
        daysPending: number;
        sprintElapsedPct: number;
        // Story counts (V2 only, decision metric)
        totalV2Tickets: number;
        completedV2Tickets: number;
        storiesPending: number;
        completionPct: number;
        completionPctSP?: number;
        // Off-track assessment
        offTrackPct: number;
        // 'not-tracked' = project.sprintAssignmentModel is 'on_the_go' -- sprint pace is
        // deliberately excluded from health scoring; completionPct/completionPctSP are
        // team-wide (totalSprintSP-based) rather than this team's slice in that case.
        onTrackStatus: 'on-track' | 'at-risk' | 'critical' | 'not-tracked';
        // Story points (reference only)
        totalV2SP: number;
        completedV2SP: number;
        inProgressV2SP: number;
        usedSP: boolean;
        // Whole-sprint (unfiltered) rollup -- optional because snapshots written before this
        // field was added won't carry it. Additive/informational for 'planned' projects;
        // drives completionPct/completionPctSP for 'on_the_go' ones.
        totalSprintSP?: number;
        completedSprintSP?: number;
        totalSprintTickets?: number;
        completedSprintTickets?: number;
        // V2's current slice, aliasing totalV2SP/completedV2SP -- informational only for
        // 'on_the_go' projects, never a target.
        v2CurrentWorkloadSP?: number;
        v2CurrentCompletedSP?: number;
        // Per-lane SP breakdown (for visual progress strip and AI context)
        todoSP: number;
        inProgressSP: number;
        inReviewSP: number;
        inQaSP: number;
        inUatSP: number;
        blockedSP: number;
        reopenedSP: number;
        // Per-lane V2 TICKET counts. Optional because snapshots written before
        // this field was added won't carry it. Used by the Delivery Presentation
        // Live Status card to show "Lane | Tickets | SP" with both numbers
        // sourced from the same V2-sprint scope.
        todoV2Tickets?: number;
        inProgressV2Tickets?: number;
        inReviewV2Tickets?: number;
        inQaV2Tickets?: number;
        inUatV2Tickets?: number;
        blockedV2Tickets?: number;
        reopenedV2Tickets?: number;
        // Human-readable "what counts as Done" for this project's board -- computed from this
        // project's own lane config, not hardcoded to any one project. Optional because
        // snapshots written before this field existed won't carry it.
        doneStatusLabels?: string[];
    } | null;

    @Column({
        type: DataType.JSONB,
        allowNull: true,
        field: 'confirmed_prod_bug_keys',
        defaultValue: null
    })
    confirmedProdBugKeys?: string[] | null;

    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'sub_bugs_logged_count',
        defaultValue: null
    })
    subBugsLoggedCount?: number | null;

    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'reopened_tickets_count',
        defaultValue: null
    })
    reopenedTicketsCount?: number | null;

    @Column({
        type: DataType.JSONB,
        allowNull: true,
        field: 'team_member_attribution',
        defaultValue: null
    })
    teamMemberAttribution?: Record<string, string[]> | null;

    @Column({
        type: DataType.JSONB,
        allowNull: true,
        field: 'data_quality_flags',
        defaultValue: null
    })
    dataQualityFlags?: {
        healthOverridden?: boolean;
        aiHealth?: string;
        prodBugsScrubbed?: number;
    } | null;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'health_rationale',
        defaultValue: null
    })
    healthRationale?: string | null;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'ticket_details',
        defaultValue: null
    })
    ticketDetails?: string | null;

    // Structured pairing of {key, issueType, status, description} built server-side from real
    // Jira data, so the frontend can render ticket-detail chips without depending on the AI
    // reproducing an exact `KEY: [Type] description` text format. ticketDetails (above) is kept
    // unchanged for CSV/plain-text export and the weekly-rollup AI prompt.
    @Column({
        type: DataType.JSONB,
        allowNull: true,
        field: 'ticket_details_structured',
        defaultValue: null
    })
    ticketDetailsStructured?: Array<{ key: string; issueType: string; status: string; description: string }> | null;

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
        type: DataType.DATE,
        defaultValue: DataType.NOW,
        field: 'updated_at'
    })
    updatedAt!: Date;

    // The activity window actually used to generate this snapshot, set ONLY on first
    // generation and never overwritten by a later regeneration. Nullable because rows
    // written before this column existed have none -- getReportDateRange falls back to
    // its (mutable-updatedAt-based) heuristic for those, once, then locks in whatever
    // window that run computes. See getReportDateRange's doc comment for why this exists:
    // re-deriving "was this the original generation" from `updatedAt` on every call
    // silently corrupts on repeated same-day resyncs of past dates.
    @Column({
        type: DataType.DATE,
        allowNull: true,
        field: 'window_start'
    })
    windowStart?: Date | null;

    @Column({
        type: DataType.DATE,
        allowNull: true,
        field: 'window_end'
    })
    windowEnd?: Date | null;
}
