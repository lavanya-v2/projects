import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Project } from './Project';
import { User } from './User';

@Table({
    tableName: 'perf_sprint_syncs',
    timestamps: true,
    underscored: true,
})
export class PerfSprintSync extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => Project)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'project_id' })
    projectId!: number;

    @BelongsTo(() => Project)
    project!: Project;

    @Column({ type: DataType.INTEGER, allowNull: true, field: 'jira_sprint_id' })
    jiraSprintId!: number | null;

    @Column({ type: DataType.STRING(255), allowNull: false, field: 'sprint_name' })
    sprintName!: string;

    @Column({ type: DataType.STRING(255), allowNull: true, field: 'period_label' })
    periodLabel!: string | null;

    @Column({ type: DataType.DATEONLY, allowNull: false, field: 'start_date' })
    startDate!: string;

    @Column({ type: DataType.DATEONLY, allowNull: false, field: 'end_date' })
    endDate!: string;

    /** 'sprint' | 'kanban' */
    @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'sprint', field: 'sync_type' })
    syncType!: string;

    /** 'pending' | 'running' | 'done' | 'error' */
    @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'pending', field: 'sync_status' })
    syncStatus!: string;

    @Column({ type: DataType.TEXT, allowNull: true, field: 'error_message' })
    errorMessage!: string | null;

    @Column({ type: DataType.DATE, allowNull: true, field: 'synced_at' })
    syncedAt!: Date | null;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'triggered_by_user_id' })
    triggeredByUserId!: number | null;

    @BelongsTo(() => User, 'triggeredByUserId')
    triggeredBy!: User | null;

    // Total SP that was in this sprint at sprint-start time, reconstructed by
    // walking each ticket's Sprint-field and Story-Points-field changelogs.
    // Null for syncs that haven't been backfilled yet, and for kanban syncs
    // (no sprint concept). Net Scope Change = finalScope - committedSp.
    @Column({ type: DataType.DECIMAL(10, 2), allowNull: true, field: 'committed_sp' })
    committedSp!: number | null;

    // Cross-validation between our reconstruction and Jira's authoritative
    // sprint-report API. Stored at sync time; powers UI divergence badges and
    // the audit query. Shape: { ourCommittedSp, jiraInitialCompletedSp,
    // jiraInitialNotCompletedSp, jiraInitialPuntedSp, ourCompletedSp,
    // jiraCompletedSp, jiraCompletedInAnotherSp, divergenceFlags[] }.
    @Column({ type: DataType.JSONB, allowNull: true, field: 'quality_report' })
    qualityReport!: PerfSprintQualityReport | null;
}

export interface PerfSprintQualityReport {
    ourCommittedSp: number | null;
    jiraInitialCompletedSp: number | null;
    jiraInitialNotCompletedSp: number | null;
    jiraInitialPuntedSp: number | null;
    ourCompletedSp: number | null;
    jiraCompletedSp: number | null;
    jiraCompletedInAnotherSp: number | null;
    /** Flags like 'committed_diff_gt_10pct', emitted when |ours-jira| / max > 0.10. */
    divergenceFlags: string[];
    // Defect-leakage counts computed at sync time from all Bug/Sub-bug CREATED in
    // this sprint's date window (project-wide, reporter-agnostic, whole-team).
    // Optional: absent on rows synced before this was added (treated as 0).
    /** All valid (non-invalid) bugs raised in the window — leakage denominator. */
    bugsRaised?: number;
    /** Valid production-escaped bugs in the window — leakage numerator. */
    prodBugsEscaped?: number;
    /** prodBugsEscaped / bugsRaised as a percentage. */
    leakageRatePct?: number;
    /** Keys of the created-in-window prod bugs (the leakage numerator) — drives the Leakage table. */
    prodBugKeys?: string[];
    // Production bugs WORKED in the sprint (Environment=Prod on the sprint board,
    // regardless of when created). Distinct from the created-in-window leakage above.
    /** Count of prod bugs worked in the sprint. */
    prodBugsWorkedCount?: number;
    /** Story points of the prod bugs worked in the sprint. */
    prodBugsWorkedSp?: number;
    /** Keys of the prod bugs worked in the sprint — drives the Production Bugs table. */
    prodBugsWorkedKeys?: string[];
    /** Count of INVALID worked prod bugs (Root Cause Bad Data / Invalid Bug /
     *  Incomplete Requirement). */
    prodBugsWorkedInvalidCount?: number;
    /** Story points of the invalid worked prod bugs. */
    prodBugsWorkedInvalidSp?: number;
    /** Keys of the invalid worked prod bugs. */
    prodBugsWorkedInvalidKeys?: string[];
    /** Count of tickets in the sprint reopened from UAT (wasUatRejected). Count-only, no rate. */
    uatReopenedCount?: number;
    /** Keys of the UAT-reopened tickets — drives the UAT Reopens table. */
    uatReopenedKeys?: string[];
}
