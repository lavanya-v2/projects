import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Project } from './Project';
import { PerfSprintSync } from './PerfSprintSync';

@Table({
    tableName: 'perf_ticket_facts',
    timestamps: false,
    underscored: true,
})
export class PerfTicketFact extends Model {
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

    @Column({ type: DataType.STRING(50), allowNull: false, field: 'jira_key' })
    jiraKey!: string;

    @Column({ type: DataType.STRING(50), allowNull: true, field: 'parent_key' })
    parentKey!: string | null;

    /** Jira issue type of `parent_key` (e.g. 'Epic', 'Story'). Needed by the QA
     *  in-cycle-catch metric: a standalone Bug parented to an EPIC can never have
     *  its parent present in a cycle's facts, so scoring it as a missed catch is
     *  meaningless. Null for rows synced before this column existed, and treated
     *  the same as an Epic (not applicable) so missing data never penalises. */
    @Column({ type: DataType.STRING(100), allowNull: true, field: 'parent_issue_type' })
    parentIssueType!: string | null;

    @Column({ type: DataType.STRING(500), allowNull: true })
    summary!: string | null;

    @Column({ type: DataType.STRING(100), allowNull: true, field: 'issue_type' })
    issueType!: string | null;

    @Column({ type: DataType.STRING(255), allowNull: true, field: 'assignee_jira_id' })
    assigneeJiraId!: string | null;

    @Column({ type: DataType.STRING(255), allowNull: true, field: 'assignee_name' })
    assigneeName!: string | null;

    @Column({ type: DataType.STRING(255), allowNull: true, field: 'reporter_jira_id' })
    reporterJiraId!: string | null;

    @Column({ type: DataType.STRING(255), allowNull: true, field: 'reporter_name' })
    reporterName!: string | null;

    @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0, field: 'story_points' })
    storyPoints!: number;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'was_completed' })
    wasCompleted!: boolean;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'was_reopened' })
    wasReopened!: boolean;

    /** Count of real reopen events that were DISREGARDED because the ticket carried
     *  a reopen-exclusion label (Invalid-Reopen / Bad-Data / Scope-Change). This is
     *  min(reopenEventCount, excludedCount) — i.e. how many genuine reopens were
     *  excluded from the reopen ratio. Surfaced as the per-sprint "invalid reopens"
     *  metric. 0 for rows synced before this column existed (needs re-sync to fill). */
    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'invalid_reopen_count' })
    invalidReopenCount!: number;

    /** Jira "Root Cause" custom field value (customfield_10414), e.g. 'Invalid Bug',
     *  'Regression', 'Bad Data', 'Incomplete Requirement'. Stored raw (unnormalised);
     *  Null when unset. */
    @Column({ type: DataType.STRING, allowNull: true, field: 'root_cause' })
    rootCause!: string | null;

    /** True when this ticket is flagged an "invalid bug": Root Cause fuzzy-matches
     *  'Invalid Bug', 'Bad Data' or 'Incomplete Requirement', OR it carries a fuzzy
     *  invalid-bug label. Drives the Invalid Bugs chart.
     *  0/false for rows synced before this column existed (needs re-sync to fill). */
    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'invalid_bug' })
    invalidBug!: boolean;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'was_scope_change' })
    wasScopeChange!: boolean;

    /** Hours from first "In Progress" → first QA status (developer cycle time) */
    @Column({ type: DataType.FLOAT, allowNull: true, field: 'cycle_time_hours' })
    cycleTimeHours!: number | null;

    /** Total hours the ticket spent in any QA status */
    @Column({ type: DataType.FLOAT, allowNull: true, field: 'time_in_qa_hours' })
    timeInQaHours!: number | null;

    /** Person who last transitioned the ticket from QA → Done/UAT */
    @Column({ type: DataType.STRING(255), allowNull: true, field: 'qa_tester_jira_id' })
    qaTesterJiraId!: string | null;

    @Column({ type: DataType.STRING(255), allowNull: true, field: 'qa_tester_name' })
    qaTesterName!: string | null;

    /** Bug severity: Critical | High | Medium | Low (only for Bug issue type) */
    @Column({ type: DataType.STRING(50), allowNull: true, field: 'bug_priority' })
    bugPriority!: string | null;

    /** True when jira_key appears in DailyBoardSnapshot.confirmedProdBugKeys for this project */
    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_production_bug' })
    isProductionBug!: boolean;

    /** True when ticket was removed (punted) from the sprint mid-flight */
    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'was_punted' })
    wasPunted!: boolean;

    /** True when ticket moved from UAT back to QA or In Progress (UAT rejection) */
    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'was_uat_rejected' })
    wasUatRejected!: boolean;

    /** Jira's native `created` timestamp for the ticket. Used to attribute a bug
     *  to the sprint in which it was actually logged (vs. carryovers picked up by
     *  later syncs). Nullable for rows synced before this column was added. */
    @Column({ type: DataType.DATE, allowNull: true, field: 'jira_created_at' })
    jiraCreatedAt!: Date | null;

    /** True when this not-completed ticket was already counted as carried SP for the
     *  same assignee in the immediately-preceding Kanban cycle. Excluded from
     *  spCarriedOver/spPlanned in computeMemberScores to avoid re-counting the same
     *  open ticket's full points every week it stays open (see LS Baban Tiwari /
     *  158-vs-67-SP investigation, Aug 2026). Always false for sprint syncs. */
    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_repeat_carryover' })
    isRepeatCarryover!: boolean;

    /** True when this ticket's only in-window activity is an assignee change onto a
     *  ticket already sitting in an awaiting-release status (Pending Deployment /
     *  Ready for Deployment / Ready for Release) — an administrative ownership
     *  handoff, not new work. Excluded from spCarriedOver/spilloverCount entirely.
     *  Always false for sprint syncs. */
    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_administrative_reassignment' })
    isAdministrativeReassignment!: boolean;

    /** True when this ticket's only in-window status activity is a transition
     *  between two statuses that were ALREADY both effectively-done (e.g.
     *  Pending Deployment -> Closed, a bulk release/close-out of already-finished
     *  work) — not a genuine new completion this cycle. wasCompleted stays false
     *  for these; excluded from spDone AND spCarriedOver entirely, since the real
     *  work (and its true completion) happened in an earlier cycle, not this one
     *  (see LS Jul 27-31 bulk-release investigation, Aug 2026). Always false for
     *  sprint syncs. */
    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_prior_period_completion' })
    isPriorPeriodCompletion!: boolean;

    @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'synced_at' })
    syncedAt!: Date;
}
