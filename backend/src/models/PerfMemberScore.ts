import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Project } from './Project';
import { PerfSprintSync } from './PerfSprintSync';
import { User } from './User';
import { TeamMember } from './TeamMember';

@Table({
    tableName: 'perf_member_scores',
    timestamps: true,
    underscored: true,
})
export class PerfMemberScore extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => PerfSprintSync)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'sync_id' })
    syncId!: number;

    @BelongsTo(() => PerfSprintSync)
    sync!: PerfSprintSync;

    @ForeignKey(() => Project)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'project_id' })
    projectId!: number;

    @BelongsTo(() => Project)
    project!: Project;

    @Column({ type: DataType.STRING(255), allowNull: false, field: 'jira_login_id' })
    jiraLoginId!: string;

    /**
     * Resolved identity, written at sync time via a confirmed PerfIdentityLink.
     * NULL means this score could not be attributed to a team member — the
     * performance review module treats that as zero system coverage rather than
     * dropping the row, so an unresolved identity is visible instead of silent.
     */
    @ForeignKey(() => TeamMember)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'team_member_id' })
    teamMemberId!: number | null;

    @BelongsTo(() => TeamMember)
    teamMember!: TeamMember | null;

    @Column({ type: DataType.STRING(255), allowNull: false, field: 'display_name' })
    displayName!: string;

    /** 'developer' | 'qa' | 'other' */
    @Column({ type: DataType.STRING(50), allowNull: false, defaultValue: 'developer', field: 'member_category' })
    memberCategory!: string;

    // ── Developer metrics ───────────────────────────────────────────────────

    @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0, field: 'sp_planned' })
    spPlanned!: number;

    @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0, field: 'sp_done' })
    spDone!: number;

    @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0, field: 'sp_carried_over' })
    spCarriedOver!: number;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'delivered_count' })
    deliveredCount!: number;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'spillover_count' })
    spilloverCount!: number;

    /** DISPLAY ONLY — story points on this developer's still-open tickets in the
     *  cycle. Unlike `spCarriedOver` this INCLUDES repeat carryovers, so it is
     *  the honest answer to "how much work is pending with them".
     *
     *  `spCarriedOver` deliberately omits a ticket already carried last cycle so
     *  its points are not counted twice across cycles — correct for scoring, but
     *  it understates pending work badly (LS Jul 27-31: one developer showed 4
     *  carried SP while actually holding 30 SP open, another showed 0 while
     *  holding 6). Hence a separate field rather than changing that one.
     *
     *  MUST NOT feed spPlanned, deliveryPct or executionScore — scoring is
     *  unchanged by this. Null on rows synced before the column existed; the UI
     *  falls back to the open-ticket count there. */
    @Column({ type: DataType.FLOAT, allowNull: true, field: 'sp_open' })
    spOpen!: number | null;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'reopened_count' })
    reopenedCount!: number;

    /** Reopens disregarded for this member due to exclusion labels (sum of the
     *  facts' invalid_reopen_count). Surfaced as the per-sprint "invalid reopens"
     *  metric. 0 for rows scored before this column existed (needs re-sync). */
    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'invalid_reopened_count' })
    invalidReopenedCount!: number;

    @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0, field: 'sp_rework' })
    spRework!: number;

    @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0, field: 'rework_factor' })
    reworkFactor!: number;

    @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0, field: 'reopen_rate_pct' })
    reopenRatePct!: number;

    @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0, field: 'delivery_pct' })
    deliveryPct!: number;

    @Column({ type: DataType.FLOAT, allowNull: true, field: 'avg_cycle_time_hours' })
    avgCycleTimeHours!: number | null;

    @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0, field: 'execution_score' })
    executionScore!: number;

    // ── QA metrics ──────────────────────────────────────────────────────────

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'bugs_raised_count' })
    bugsRaisedCount!: number;

    // Subset of bugsRaisedCount flagged "invalid bug" (Root Cause fuzzy-matching
    // 'Invalid Bug' / 'Bad Data' / 'Incomplete Requirement', OR a fuzzy invalid-bug
    // label), attributed to the QA who raised it. Feeds the
    // per-sprint Invalid Bugs chart. 0 for rows synced before this column existed.
    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'invalid_bugs_count' })
    invalidBugsCount!: number;

    // Subset of bugsRaisedCount: facts whose issue type contains 'bug' but is NOT
    // exactly 'bug' (i.e. Sub-bug variants — typically rework defects against a
    // parent story). Useful for splitting top-level Bug vs Sub-bug in narratives,
    // since reopens only count parent-story transitions and not sub-bug filings.
    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'sub_bugs_raised_count' })
    subBugsRaisedCount!: number;

    // Off-board bugs: standalone Bugs / Sub-bugs this member reported within the
    // sprint window that were NOT attached to the sprint on the board (so they
    // never entered perf_ticket_facts). Kept separate from bugs_raised_count /
    // sub_bugs_raised_count so quality_rate and leakage math stay board-scoped;
    // the member dashboard adds these to the on-board counts for display only.
    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'offboard_bugs_raised_count' })
    offboardBugsRaisedCount!: number;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'offboard_sub_bugs_raised_count' })
    offboardSubBugsRaisedCount!: number;

    /** { critical: n, high: n, medium: n, low: n } */
    @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {}, field: 'bugs_by_priority' })
    bugsByPriority!: Record<string, number>;

    @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0, field: 'weighted_bug_score' })
    weightedBugScore!: number;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'tickets_tested_count' })
    ticketsTestedCount!: number;

    @Column({ type: DataType.FLOAT, allowNull: true, field: 'avg_qa_cycle_time_hours' })
    avgQaCycleTimeHours!: number | null;

    /** Production bugs in this sprint attributed to this QA member (tickets they tested) */
    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'prod_bugs_escaped' })
    prodBugsEscaped!: number;

    @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0, field: 'bug_escape_rate_pct' })
    bugEscapeRatePct!: number;

    /**
     * Composite QA risk rate: (1 − (0.7 × UAT pass-rate + 0.3 × in-sprint catch)) × 100.
     * Lower = better. -1 sentinel = insufficient tested count (<5).
     */
    @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0, field: 'quality_rate' })
    qualityRate!: number;

    // ── Raw QA accumulators ─────────────────────────────────────────────────
    //
    // The numerators and denominators behind `qualityRate`. Persisted because a
    // review cycle spanning several sprints must re-derive the rate from SUMMED
    // counters — averaging per-sprint percentages weights a 3-ticket sprint the
    // same as a 40-ticket one. Nullable: rows synced before these columns existed
    // have no values, and the review module falls back to a documented
    // tickets-weighted proxy for those.

    /** Story points this member cleared through QA. UAT pass-rate denominator. */
    @Column({ type: DataType.FLOAT, allowNull: true, field: 'cleared_sp' })
    clearedSp!: number | null;

    /** Of those, story points later rejected in UAT. Pass-rate numerator. */
    @Column({ type: DataType.FLOAT, allowNull: true, field: 'uat_failed_sp' })
    uatFailedSp!: number | null;

    /** Bugs caught within the sprint. In-sprint catch numerator. */
    @Column({ type: DataType.FLOAT, allowNull: true, field: 'in_sprint_bug_count' })
    inSprintBugCount!: number | null;

    /** Bugs eligible to be caught in-sprint. Catch-rate denominator. */
    @Column({ type: DataType.FLOAT, allowNull: true, field: 'in_sprint_eligible_count' })
    inSprintEligibleCount!: number | null;

    // ── Lead overrides ──────────────────────────────────────────────────────

    /** Keys present here override the computed metric values */
    @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {}, field: 'overridden_metrics' })
    overriddenMetrics!: Record<string, number>;

    @Column({ type: DataType.TEXT, allowNull: true, field: 'override_reason' })
    overrideReason!: string | null;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'overridden_by_user_id' })
    overriddenByUserId!: number | null;

    @BelongsTo(() => User, 'overriddenByUserId')
    overriddenBy!: User | null;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_overridden' })
    isOverridden!: boolean;
}
