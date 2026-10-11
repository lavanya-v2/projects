export type IdentitySource = 'jira' | 'excel' | 'azure';
export type IdentityMatchMethod = 'auto_email' | 'auto_fuzzy' | 'manual';
export type IdentityLinkStatus = 'suggested' | 'confirmed' | 'rejected';

export interface IdentityCandidate {
  sourceKey: string;
  sourceDisplayName: string | null;
  /** 1.0 exact Jira login · 0.95 email · 0.9 exact name · 0.75 substring · 0.6 spelling */
  confidence: number;
  method: IdentityMatchMethod;
  rationale: string;
  /** How many score rows carry this identity. */
  scoreRowCount: number;
}

export interface UnresolvedMember {
  teamMemberId: number;
  teamMemberName: string;
  email: string;
  /** Set when the seeder has already proposed a specific identity for this person. */
  linkId: number | null;
  candidates: IdentityCandidate[];
}

/**
 * The go/no-go gate for a project.
 *
 * The denominator is roster members this project's delivery data actually has
 * something to say about — not every delivery identity that ever appeared.
 * `undecidedKeyCount` is what blocks: roster members with no confirmed identity.
 */
export interface IdentityCoverage {
  projectId: number;
  totalRosterMembers: number;
  resolvedMembers: number;
  linkedPct: number;
  undecidedKeyCount: number;
  rejectedKeyCount: number;
  staleLinkCount: number;
  suggestedPendingCount: number;
  /** Score rows with no roster counterpart at all — informational, never a gate. */
  nonRosterRowCount: number;
  totalScoreRows: number;
}

export interface IdentityOverview {
  coverage: IdentityCoverage;
  unresolved: UnresolvedMember[];
  /** Every raw delivery identity in the project, for the manual-link picker. */
  availableIdentities: Array<{ sourceKey: string; sourceDisplayName: string | null; scoreRowCount: number }>;
}

export interface SeedResult {
  created: number;
  refreshed: number;
  unmatched: number;
  coverage: IdentityCoverage;
}

export interface BulkConfirmResult {
  confirmed: number;
  propagatedToProjects: number;
  skipped: number;
  coverage: IdentityCoverage;
}

// ── Configuration & rollout ─────────────────────────────────────────────────

export type ReviewCadence = 'monthly' | 'quarterly';

export interface ReviewCycleConfig {
  id: number;
  accountId: number;
  /** Empty = every project in the account. Non-empty bounds the rollout. */
  scopeProjectIds: number[];
  cadence: ReviewCadence;
  anchorDate: string;
  timezone: string;
  reviewYearStartMonth: number;
  weightSystem: number;
  weightLead: number;
  weightCustomer: number;
  leadTemplateId: number | null;
  isEnabled: boolean;
  /** Set once, at first creation. Null for accounts set up before this existed. */
  setupDate: string | null;
}

/** Per-project rollout readiness. Informational — see Phase 8 — not a precondition. */
export interface ProjectDataHealth {
  projectId: number;
  isSharedTeam: boolean;
  lastSyncEndDate: string | null;
  hasRecentSync: boolean;
  healthy: boolean;
  reasons: string[];
}

export interface RolloutProject {
  projectId: number;
  name: string;
  dataSourceType: string;
  isActive: boolean;
  inScope: boolean;
  gate: {
    ready: boolean;
    undecidedKeyCount: number;
    linkedPct: number;
    totalScoreRows: number;
  };
  dataHealth: ProjectDataHealth | null;
}

export interface ReviewConfigResponse {
  config: ReviewCycleConfig | null;
  rollout: RolloutProject[];
}

export interface EligibleReviewer {
  id: number;
  firstName: string;
  lastName: string;
  roleName: string;
}

/** A project's setup overrides — which template it uses and its default reviewer. */
export interface ProjectSettings {
  projectId: number;
  templateId: number | null;
  defaultReviewerUserId: number | null;
  eligibleReviewers: EligibleReviewer[];
}

export interface PreviewedCycle {
  periodLabel: string;
  startDate: string;
  endDate: string;
  reviewYear: string;
  sequenceNo: number;
  exists: boolean;
  status?: string;
}

// ── Competency templates ────────────────────────────────────────────────────

export type CompetencyInputType = 'rating' | 'text' | 'boolean';
export type TemplateStatus = 'draft' | 'active' | 'retired';

export interface CompetencyItem {
  id: number;
  templateId: number;
  section: string | null;
  /** Stable join key — survives relabelling so trends stay comparable. */
  key: string;
  label: string;
  description: string | null;
  inputType: CompetencyInputType;
  weight: number;
  isRequired: boolean;
  requiresComment: boolean;
  sortOrder: number;
}

export interface CompetencyTemplate {
  id: number;
  name: string;
  description: string | null;
  scope: 'global' | 'account' | 'project';
  accountId: number | null;
  version: number;
  parentTemplateId: number | null;
  status: TemplateStatus;
  ratingScaleMin: number;
  ratingScaleMax: number;
  ratingScaleLabels: Record<string, string>;
  appliesToCategory: string | null;
  items?: CompetencyItem[];
  /** Reviews authored against it. Non-zero means edits must become a new version. */
  usageCount?: number;
}

// ── Lead reviews ────────────────────────────────────────────────────────────

export type LeadReviewStatus = 'draft' | 'submitted' | 'published' | 'superseded' | 'withdrawn';

export interface EvidenceSnapshot {
  capturedAt?: string;
  systemScore?: number | null;
  systemCoverage?: number | null;
  systemPresent?: boolean;
  compositeAtSubmit?: number | null;
  memberCategory?: string;
  cycle?: { id: number; periodLabel: string; startDate: string; endDate: string };
  contributingProjectIds?: number[];
  sources?: Array<{
    sourceId: number;
    projectId: number;
    projectName?: string | null;
    /** The sprint's own identity — distinguishes rows sharing a project. */
    periodLabel?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    spPlanned?: number | null;
    spDone?: number | null;
    qualityRate?: number | null;
  }>;
  aggregates?: Record<string, number | null>;
  approximations?: string[];
  overridesApplied?: string[];
  overridesRejected?: string[];
  template?: {
    id: number; name: string; version: number;
    ratingScaleMin: number; ratingScaleMax: number;
    items: Array<{ id: number; key: string; label: string; weight: number; inputType: string }>;
  };
}

export interface LeadReview {
  id: number;
  reviewCycleId: number;
  teamMemberId: number;
  accountId: number;
  reviewerUserId: number;
  templateId: number;
  status: LeadReviewStatus;
  overallComment: string | null;
  strengths: string | null;
  improvements: string | null;
  normalizedScore: number | null;
  evidenceSnapshot: EvidenceSnapshot;
  version: number;
  supersedesReviewId: number | null;
  revisionReason: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgementComment: string | null;
}

export interface LeadReviewRating {
  id: number;
  leadReviewId: number;
  templateItemId: number;
  rating: number | null;
  textValue: string | null;
  booleanValue: boolean | null;
  comment: string | null;
  na: boolean;
}

/** Everything the form needs, including why it cannot yet be submitted. */
export interface LeadReviewDetail {
  review: LeadReview;
  template: (Pick<CompetencyTemplate, 'id' | 'name' | 'version' | 'ratingScaleMin' | 'ratingScaleMax' | 'ratingScaleLabels'> & {
    items: CompetencyItem[];
  }) | null;
  ratings: LeadReviewRating[];
  validation: { ready: boolean; problems: string[] };
}

/** One row of the lead's worklist. */
export interface ReviewAssignment {
  participantId: number;
  teamMemberId: number;
  teamMember: { id: number; firstName: string; lastName: string; email: string } | null;
  memberCategory: string;
  reviewerUserId: number | null;
  contributingProjectIds: number[];
  review: LeadReview | null;
}

export interface RatingInput {
  templateItemId: number;
  rating?: number | null;
  textValue?: string | null;
  booleanValue?: boolean | null;
  comment?: string | null;
  na?: boolean;
}

// ── Cycles (admin) ───────────────────────────────────────────────────────────

export type CycleStatus = 'scheduled' | 'open' | 'locked' | 'published' | 'archived';

export interface ReviewCycle {
  id: number;
  accountId: number;
  configId: number;
  periodLabel: string;
  startDate: string;
  endDate: string;
  reviewYear: string;
  sequenceNo: number;
  status: CycleStatus;
  weightSystem: number;
  weightLead: number;
  weightCustomer: number;
  leadTemplateId: number | null;
  scopeProjectIds: number[];
  openedAt: string | null;
  lockedAt: string | null;
  publishedAt: string | null;
  publishedByUserId: number | null;
  isCatchUp: boolean;
}

export interface CycleSource {
  id: number;
  reviewCycleId: number;
  projectId: number;
  project?: { id: number; name: string };
  sourceType: 'sprint' | 'kanban' | 'excel_import';
  perfSprintSyncId: number | null;
  sync?: { id: number; sprintName: string; periodLabel: string | null; startDate: string; endDate: string } | null;
  externalSourceId: string | null;
  attachedBy: 'auto' | 'manual';
  excluded: boolean;
  exclusionReason: string | null;
  excludedByUserId: number | null;
}

export interface CycleParticipant {
  id: number;
  reviewCycleId: number;
  teamMemberId: number;
  teamMember?: { id: number; firstName: string; lastName: string; email: string };
  memberCategory: string;
  reviewerUserId: number | null;
  contributingProjectIds: number[];
  isExcluded: boolean;
  exclusionReason: string | null;
  rosterSnapshot: Record<string, unknown>;
}

export interface EligibleReviewer {
  id: number;
  firstName: string;
  lastName: string;
  roleName: string;
}

/** teamMemberId -> the people who could plausibly review them, project-scoped. */
export type EligibleReviewersByMember = Record<number, EligibleReviewer[]>;

export interface ReviewMemberScoreRow {
  id: number;
  reviewCycleId: number;
  teamMemberId: number;
  teamMember?: { id: number; firstName: string; lastName: string; email: string };
  memberCategory: string;
  systemScore: number | null;
  leadScore: number | null;
  customerScore: number | null;
  compositeScore: number | null;
  systemPresent: boolean;
  leadPresent: boolean;
  customerPresent: boolean;
  systemCoverage: number | null;
  leadCoverage: number | null;
  customerCoverage: number | null;
  overallCoverage: number | null;
  isProvisional: boolean;
  cumCompositeScore: number | null;
  cumCoverage: number | null;
  cumCyclesCount: number;
  trendDirection: 'improved' | 'declined' | 'flat' | 'na';
  trendDelta: number | null;
  isPublished: boolean;
  contributingProjectIds: number[];
  reviewerUserId: number | null;
}

// ── Member self-service ──────────────────────────────────────────────────────

export interface MyReviewTrendPoint {
  reviewId: number;
  cycleId: number;
  periodLabel: string | null;
  startDate: string | null;
  endDate: string | null;
  composite: number | null;
  systemScore: number | null;
  leadScore: number | null;
  overallCoverage: number | null;
  isProvisional: boolean;
  trendDirection: 'improved' | 'declined' | 'flat' | 'na';
  trendDelta: number | null;
  acknowledgedAt: string | null;
}

export interface MyReviewsResponse {
  teamMember: { id: number; firstName: string; lastName: string } | null;
  reviews: LeadReview[];
  trend: MyReviewTrendPoint[];
}

/** Dashboard-sized summary — the caller's own pending status, and, if they're also a reviewer, their pending assignment count. */
export interface PendingReviewStatus {
  member: {
    hasPendingReview: boolean;
    pendingCycle: { id: number; periodLabel: string } | null;
    latestPublished: { periodLabel: string | null; compositeScore: number | null } | null;
  } | null;
  lead: {
    pendingCount: number;
    cycle: { id: number; periodLabel: string } | null;
  } | null;
}

export interface MyReviewDetail {
  review: LeadReview;
  reviewer: { id: number; firstName: string; lastName: string; userId: string } | null;
  template: (Pick<CompetencyTemplate, 'id' | 'name' | 'version' | 'ratingScaleMin' | 'ratingScaleMax' | 'ratingScaleLabels'> & {
    items: CompetencyItem[];
  }) | null;
  ratings: LeadReviewRating[];
  score: ReviewMemberScoreRow | null;
  evidence: EvidenceSnapshot;
}

// ── Team member history (a lead's view across team changes) ────────────────

export interface HistoryScore {
  systemScore: number | null;
  leadScore: number | null;
  compositeScore: number | null;
  overallCoverage: number | null;
  isProvisional: boolean;
  trendDirection: 'improved' | 'declined' | 'flat' | 'na';
  trendDelta: number | null;
  systemPresent: boolean;
  leadPresent: boolean;
}

/**
 * A review authored by someone other than the caller. Deliberately carries
 * NOTHING beyond these three fields — the server never sends the narrative,
 * ratings, or comments for a redacted period, so there is nothing here to
 * accidentally render.
 */
export interface RedactedReview {
  redacted: true;
  reviewerName: string | null;
  status: string;
}

export interface FullReview {
  redacted: false;
  reviewerName: string | null;
  status: string;
  normalizedScore: number | null;
  strengths: string | null;
  improvements: string | null;
  overallComment: string | null;
  ratings: Array<{
    templateItemId: number;
    rating: number | null;
    textValue: string | null;
    comment: string | null;
    na: boolean;
  }>;
}

export interface HistoryCycle {
  cycleId: number;
  periodLabel: string;
  startDate: string;
  endDate: string;
  status: string;
  contributingProjectIds: number[];
  score: HistoryScore | null;
  review: RedactedReview | FullReview | null;
}

export interface TeamMemberHistory {
  teamMember: { id: number; firstName: string; lastName: string };
  cycles: HistoryCycle[];
}
