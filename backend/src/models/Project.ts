import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { Account } from './Account';
import { AccountTeamMember } from './AccountTeamMember';
import { Program } from './Program';
import { LaneConfig } from '../common/laneDefaults';
import { TemplateMapping } from './TemplateMapping';

@Table({
  tableName: 'projects',
  timestamps: true,
})
export class Project extends Model {
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

  @ForeignKey(() => Program)
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'program_id',
  })
  programId?: number | null;

  @BelongsTo(() => Program)
  program?: Program;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  name!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    unique: true,
  })
  code!: string;

  @Column({
    type: DataType.STRING(32),
    allowNull: false,
    defaultValue: 'jira',
    field: 'data_source_type',
  })
  dataSourceType!: 'jira' | 'azure_devops' | 'excel' | 'custom-excel';

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'jira_board_id',
  })
  jiraBoardId!: number;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    field: 'jira_name',
  })
  jiraName!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    field: 'jira_base_url',
  })
  jiraBaseUrl!: string;

  @Column({
    type: DataType.STRING(512),
    allowNull: true,
    field: 'azure_org_url',
  })
  azureOrgUrl?: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    field: 'azure_project',
  })
  azureProject?: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    field: 'azure_team',
  })
  azureTeam?: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
    field: 'azure_pat',
  })
  azurePat?: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    field: 'azure_board_id',
  })
  azureBoardId?: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    field: 'jira_email',
  })
  jiraEmail?: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    field: 'jira_api_token',
  })
  jiraApiToken?: string;

  @Column({
    type: DataType.JSONB,
    allowNull: true,
    field: 'jira_lane_config',
  })
  jiraLaneConfig?: LaneConfig;

  /**
   * Per-project override of the Jira-priority-label -> severity-tier map used by the daily
   * production-bug health score (bugSeverityMath.ts). Null (the default for every existing
   * project) uses the built-in map, which already covers this app's live accounts (Normal/
   * High/Critical/Low, and Medium-only) plus Jira's own default and Blocker/Critical schemes.
   * Set this only for a project whose Jira instance uses priority labels the built-in map
   * doesn't recognize (e.g. P1/P2/Sev1) -- when set, it REPLACES the default map entirely for
   * that project, so every priority label the project actually uses must be named.
   */
  @Column({
    type: DataType.JSONB,
    allowNull: true,
    field: 'bug_priority_map',
  })
  bugPriorityMap?: Record<string, 'critical' | 'high' | 'medium' | 'low'> | null;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_shared_team',
  })
  isSharedTeam!: boolean;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_kanban_project',
  })
  isKanbanProject!: boolean;

  /**
   * How this project's team actually works: 'sprint' (Jira sprints), 'cadence'
   * (a recurring work-cycle window, e.g. Mon-Fri every week), or 'continuous'
   * (no boundaries -- backlog pulled as capacity frees up). Lands alongside
   * isKanbanProject, not instead of it, during the transition -- both stay
   * readable and in agreement (isKanbanProject=false <-> 'sprint';
   * isKanbanProject=true <-> 'cadence' or 'continuous' depending on whether a
   * work-cycle is configured). isKanbanProject is dropped once every call
   * site reads this field instead.
   */
  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    defaultValue: 'sprint',
    field: 'delivery_model',
  })
  deliveryModel!: 'sprint' | 'cadence' | 'continuous';

  // Per-project opt-in: a cadence team that genuinely commits to a set of work
  // each cycle gets sprint-style commitment/spillover reporting; one that
  // merely regroups gets N/A for those fields. Meaningless for 'sprint' or
  // 'continuous'. Defaults off -- nothing is reported as a commitment miss
  // unless a project explicitly opts in.
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'tracks_commitment',
  })
  tracksCommitment!: boolean;

  // Per-project opt-in: does the sprint team pre-plan an individual SP slice per
  // person ('planned' -- e.g. CCM, each V2 member has a fixed target), or does the
  // team commit to a total sprint SP and pick up tickets on the go with no stable
  // per-person/per-subteam scope from day 1 ('on_the_go' -- e.g. Thrive's Team
  // Delta, where V2 is a minority of the project team)? Meaningless for Kanban
  // (no sprintBurndown concept there). Defaults to 'planned' so no existing
  // project's daily report, health calculation, or progress bar changes unless
  // explicitly opted in via the admin form.
  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    defaultValue: 'planned',
    field: 'sprint_assignment_model',
  })
  sprintAssignmentModel!: 'planned' | 'on_the_go';

  /**
   * When true (the default), personal data is masked out of Jira ticket titles
   * before they are persisted or sent to the AI. Defaults ON so customer boards
   * are protected without anyone remembering to enable it; internal boards opt out.
   */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'pii_redaction_enabled',
  })
  piiRedactionEnabled!: boolean;

  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    defaultValue: 'sprint',
    field: 'work_mode',
  })
  workMode!: string;

  // Estimation unit for sprint/delivery metrics. Defaults to 'story_points' so every
  // existing project behaves exactly as before; 'hours' opts a project into hours-based
  // estimation (capacity = planned hours).
  @Column({
    type: DataType.STRING(32),
    allowNull: false,
    defaultValue: 'story_points',
    field: 'estimation_type',
  })
  estimationType!: 'story_points' | 'hours';

  // Cadence for Excel-based projects. 'daily' keeps the existing per-day snapshot
  // upload UX; 'sprint' switches to per-sprint uploads and enables the Excel Sprint
  // Board View; 'weekly' tags uploads to a week (lightweight). Only meaningful when
  // dataSourceType === 'excel'; jira/azure projects stay 'daily'.
  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    defaultValue: 'daily',
    field: 'reporting_frequency',
  })
  reportingFrequency!: 'daily' | 'weekly' | 'sprint';

  // Which coding assistant (if any) this project's team actually uses. 'none' is
  // the default for every project until an admin opts it in — gates every
  // Claude-usage UI surface (nav, dashboard card, Team Prompt Coaching) as an
  // outer gate in front of the existing per-user pilot allowlist, so a project
  // not on Claude never shows Claude-shaped UI at all, not even "coming soon".
  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    defaultValue: 'none',
    field: 'dev_assistant_ai_tool',
  })
  devAssistantAiTool!: 'claude' | 'copilot' | 'openai' | 'cursor' | 'none';

  // Only meaningful when estimationType === 'hours'. Where to read the hour estimate from
  // in Jira: 'time_tracking' (built-in Original Estimate) or 'custom_field' (hoursFieldName).
  @Column({
    type: DataType.STRING(32),
    allowNull: true,
    field: 'hours_source',
  })
  hoursSource?: 'time_tracking' | 'custom_field' | null;

  // Display name of the Jira custom field holding hour estimates (resolved like 'Story Points').
  @Column({
    type: DataType.STRING(255),
    allowNull: true,
    field: 'hours_field_name',
  })
  hoursFieldName?: string | null;

  // Default per-developer working hours per day, used to compute team capacity for
  // hours-based projects (capacity = dailyHours x workingDays x devs - leave). Null
  // falls back to 8 in code. Only meaningful when estimationType === 'hours'.
  @Column({
    type: DataType.DECIMAL(5, 2),
    allowNull: true,
    field: 'default_daily_capacity_hours',
  })
  defaultDailyCapacityHours?: number | null;

  @Column({
    type: DataType.ARRAY(DataType.TEXT),
    allowNull: true,
    field: 'kanban_done_statuses',
  })
  kanbanDoneStatuses?: string[];

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'kanban_cycle_enabled',
  })
  kanbanCycleEnabled!: boolean;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'kanban_cycle_days',
  })
  kanbanCycleDays?: number | null;

  // How often a cycle repeats, in days. Null = back-to-back (stride defaults
  // to kanbanCycleDays). Set longer than kanbanCycleDays for a
  // weekday-aligned cadence, e.g. window 5 / stride 7 for Mon-Fri every week.
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'kanban_cycle_stride_days',
  })
  kanbanCycleStrideDays?: number | null;

  @Column({
    type: DataType.DATEONLY,
    allowNull: true,
    field: 'kanban_cycle_anchor_date',
  })
  kanbanCycleAnchorDate?: string | null;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'kanban_auto_sync',
  })
  kanbanAutoSync!: boolean;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'is_active',
  })
  isActive!: boolean;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    field: 'inactive_since',
  })
  inactiveSince?: Date | null;

  @HasMany(() => AccountTeamMember)
  teamMembers!: AccountTeamMember[];

  @Column({
    type: DataType.DATE,
    defaultValue: DataType.NOW,
    field: 'created_at',
  })
  createdAt!: Date;

  @Column({
    type: DataType.DATE,
    defaultValue: DataType.NOW,
    field: 'updated_at',
  })
  updatedAt!: Date;

  @Column({
    type: DataType.BIGINT,
    field: 'template_mapping_id',
    allowNull: true,
  })
  templateMappingId?: number | null;

  @HasMany(() => TemplateMapping)
  templateMappings!: TemplateMapping[];
}
