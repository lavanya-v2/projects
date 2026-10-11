import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Account } from './Account';
import { Program } from './Program';
import { User } from './User';
import type { CustomSection } from '../modules/reports/services/customSections';

export interface PortfolioMilestone {
  milestone: string;
  status: string;
  percentComplete: number;
  eta: string;
  projectName?: string;
}

export interface PortfolioRiskSnapshot {
  projectId?: number | null;
  projectName: string;
  title: string;
  description?: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'NEW' | 'WORK_IN_PROGRESS' | 'STALE' | 'DONE';
  source?: 'CLIENT' | 'INTERNAL';
}

export interface PortfolioActionItemSnapshot {
  id?: number;
  projectId?: number | null;
  projectName: string;
  title: string;
  owner: string;
  status: string;
  dueDate?: string | null;
  category: string;
  source: 'project' | 'account' | 'program';
}

/** Presentation-only flag marking a sprint as reduced-capacity so it is excluded
 *  from the Velocity Trend average line. The presenter sets these manually (leave
 *  is not tracked); `reason` annotates the chart. */
export interface VelocityCapacityFlag {
  projectId: number;
  syncId: number;
  sprintName: string;
  reason: string;
}

/** Presentation-only row for the optional Team Capacity table. Pre-seeded with V2
 *  members (name + delivered SP for a single-sprint presentation); leaves are always
 *  entered manually. Users may add free-text rows for anyone not on a project. */
export interface TeamCapacityRow {
  name: string;
  jiraLoginId?: string | null;
  sprint: string;
  plannedLeaves: number | null;
  unplannedLeaves: number | null;
  storyPointsDelivered: number | null;
  carryOverSp: number | null;
}

export interface PortfolioKeyHighlights {
  summary: string;
  achievements: string[];
  blockers: string[];
  capacityNotes: string[];
}

export interface PortfolioPerProjectDrilldown {
  projectId: number | null;
  projectName: string;
  health?: 'Green' | 'Amber' | 'Red'; // system-computed (mean of WSR statuses in window)
  healthOverride?: 'Green' | 'Amber' | 'Red' | null; // manual override; null = use computed. Preserved on refresh.
  narrative: string;
  sprintName: string;
  sprintMetrics: {
    capacity?: number;
    planned?: number;
    actual?: number;
    scopeChange?: number;
    reworkPct?: number;
    carryoverPct?: number;
  };
  qualityMetrics: {
    storyPoints?: number;
    validBugs?: number;
    bugDensityPct?: number;
    bugsProd?: number;
    leakageRatePct?: number;
    uiBugs?: number;
    apiBugs?: number;
    cssBugs?: number;
    dbBugs?: number;
    otherBugs?: number;
  };
  teamMembers: Array<{
    name: string;
    role: string;
    storyPoints?: number;
    execution?: number;
    quality?: number;
    overallRating?: number;
  }>;
  isVisible: boolean;
  // Range-mode uncovered-window signal: true when a synced sprint overlapped the
  // reporting window but only marginally (a predecessor) and was excluded, so no
  // meaningful sprint data is shown. windowCoverageWarning holds the banner text.
  rangeSprintUnsynced?: boolean;
  windowCoverageWarning?: string | null;
}

export interface PortfolioTrendSprint {
  name: string;
  startDate?: string;
  endDate?: string;
  metrics: {
    capacity?: number;
    planned?: number;
    actual?: number;
    reworkPct?: number;
    carryoverPct?: number;
  };
  qualityMetrics: {
    storyPoints?: number;
    validBugs?: number;
    bugDensityPct?: number;
    bugsProd?: number;
    leakageRatePct?: number;
    leakageBugsRaised?: number;
    reopenedCount?: number;
    deliveredCount?: number;
    reopenRatePct?: number;
    prodBugsWorked?: number;
    prodBugsWorkedSp?: number;
    prodBugsWorkedInvalid?: number;
    prodBugsWorkedInvalidSp?: number;
    uatReopenedCount?: number;
    prodBugKeys?: string[];
    prodBugsWorkedKeys?: string[];
    prodBugsWorkedInvalidKeys?: string[];
    uatReopenedKeys?: string[];
  };
}

export interface PortfolioTrendData {
  [projectId: string]: {
    projectName: string;
    sprints: PortfolioTrendSprint[];
    jiraBaseUrl?: string | null;
  };
}

@Table({
  tableName: 'portfolio_presentations',
  timestamps: true,
  underscored: true,
})
export class PortfolioPresentation extends Model {
  @Column({
    primaryKey: true,
    autoIncrement: true,
    type: DataType.INTEGER,
  })
  id!: number;

  @ForeignKey(() => Account)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: 'account_id',
  })
  accountId!: number;

  @BelongsTo(() => Account)
  account!: Account;

  // Set when the presentation is built from a single Program. Enables pulling
  // program-level action items into the snapshot. Null for account-scoped builds.
  @ForeignKey(() => Program)
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'program_id',
  })
  programId!: number | null;

  @BelongsTo(() => Program)
  program!: Program | null;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  title!: string;

  @Column({
    type: DataType.DATEONLY,
    allowNull: false,
    field: 'meeting_date',
  })
  meetingDate!: string;

  @Column({
    type: DataType.DATEONLY,
    allowNull: false,
    field: 'start_date',
  })
  startDate!: string;

  @Column({
    type: DataType.DATEONLY,
    allowNull: false,
    field: 'end_date',
  })
  endDate!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: 'Green',
  })
  health!: 'Green' | 'Amber' | 'Red';

  @Column({
    type: DataType.JSONB,
    allowNull: true,
    defaultValue: [],
    field: 'selected_project_ids',
  })
  selectedProjectIds!: number[];

  @Column({
    type: DataType.JSONB,
    allowNull: true,
    defaultValue: {},
    field: 'selected_sprint_map',
  })
  selectedSprintMap!: Record<string, number | null>;

  // How the reporting window was chosen in the form: free-form date range
  // ('range', default) or a single completed sprint ('sprint'). Persisted so an
  // edit reopens in the same mode.
  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: 'range',
    field: 'date_selection_mode',
  })
  dateSelectionMode!: 'range' | 'sprint';

  // The Jira sprint id chosen when dateSelectionMode === 'sprint' (null in range
  // mode). Only meaningful for single-project presentations.
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'selected_sprint_id',
  })
  selectedSprintId!: number | null;

  @Column({
    type: DataType.JSONB,
    allowNull: true,
    defaultValue: {},
    field: 'key_highlights',
  })
  keyHighlights!: PortfolioKeyHighlights;

  // Baseline AI-generated summary. Set on create and on every successful AI
  // regen. refreshFromSystem regenerates only when keyHighlights.summary still
  // matches this value (i.e. user has not edited it).
  @Column({
    type: DataType.TEXT,
    allowNull: true,
    field: 'original_ai_summary',
  })
  originalAiSummary!: string | null;

  @Column({
    type: DataType.JSONB,
    allowNull: true,
    defaultValue: [],
  })
  milestones!: PortfolioMilestone[];

  @Column({
    type: DataType.JSONB,
    allowNull: true,
    defaultValue: [],
  })
  risks!: PortfolioRiskSnapshot[];

  @Column({
    type: DataType.JSONB,
    allowNull: true,
    defaultValue: [],
    field: 'action_items_snapshot',
  })
  actionItemsSnapshot!: PortfolioActionItemSnapshot[];

  @Column({
    type: DataType.JSONB,
    allowNull: true,
    defaultValue: [],
    field: 'tech_recommendations',
  })
  techRecommendations!: string[];

  @Column({
    type: DataType.JSONB,
    allowNull: true,
    defaultValue: [],
    field: 'discussion_points',
  })
  discussionPoints!: string[];

  @Column({
    type: DataType.JSONB,
    allowNull: true,
    defaultValue: [],
    field: 'per_project_drilldown',
  })
  perProjectDrilldown!: PortfolioPerProjectDrilldown[];

  @Column({
    type: DataType.JSONB,
    allowNull: true,
    defaultValue: {},
    field: 'trend_data',
  })
  trendData!: PortfolioTrendData;

  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
    field: 'custom_sections',
  })
  customSections!: CustomSection[];

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'created_by_user_id',
  })
  createdByUserId!: number | null;

  @BelongsTo(() => User, 'created_by_user_id')
  createdByUser!: User | null;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
    field: 'meeting_transcript',
  })
  meetingTranscript!: string | null;

  /** Free-text notes the presenter types live during the presentation, keyed by
   *  slide id (e.g. { 'trends': 'client flagged sprint 6.1 dip' }). Pure
   *  persistence — fed into MOM generation, never auto-summarised. */
  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: {},
    field: 'presenter_notes',
  })
  presenterNotes!: Record<string, string>;

  /** Per-presentation visibility of the default Trends-slide charts, keyed by
   *  chart id (see frontend trendCharts.ts). `true` = hidden. Empty/absent map
   *  means every chart is shown. Carried forward on clone. */
  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: {},
    field: 'hidden_charts',
  })
  hiddenCharts!: Record<string, boolean>;

  /** Presentation-only free-text note per trend chart, keyed by chart id (see
   *  frontend trendCharts.ts, e.g. { 'velocity-trend': '6.1 reduced capacity' }).
   *  Rendered under the chart on the slide and in the PDF. Empty map = no notes. */
  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: {},
    field: 'graph_notes',
  })
  graphNotes!: Record<string, string>;

  /** Presentation-only list of sprints the presenter marked as reduced-capacity;
   *  excluded from the Velocity Trend average line. Empty array = none. */
  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
    field: 'velocity_capacity_flags',
  })
  velocityCapacityFlags!: VelocityCapacityFlag[];

  /** Presentation-only rows for the optional Team Capacity table. Empty = the
   *  table (a hidden-by-default item) has no data. */
  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
    field: 'team_capacity_rows',
  })
  teamCapacityRows!: TeamCapacityRow[];

  @Column({
    type: DataType.TEXT,
    allowNull: true,
    field: 'mom_content',
  })
  momContent!: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    field: 'mom_generated_at',
  })
  momGeneratedAt!: Date | null;

  @Column({
    type: DataType.STRING(20),
    allowNull: true,
    field: 'mom_status',
  })
  momStatus!: 'draft' | 'accepted' | null;

  /** Number of times the MOM has been (re)generated with AI for this
   *  presentation. Capped at 3 to avoid token over-usage; non-AI saves do not
   *  increment it. */
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'mom_generate_attempts',
  })
  momGenerateAttempts!: number;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    field: 'locked_at',
  })
  lockedAt!: Date | null;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'locked_by_id',
  })
  lockedById!: number | null;
}
