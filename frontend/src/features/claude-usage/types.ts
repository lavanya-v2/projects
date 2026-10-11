// Mirrors the backend PromptReport / TeamReport shapes
// (backend/src/modules/usageCollector/services/claudeUsageReportService.ts).

export interface DailyPoint {
  day: string;
  /** null when nothing was scored that day — render a gap, not a zero. */
  avgScore: number | null;
  good: number;
  ok: number;
  poor: number;
  tokens: number;
  cost: number;
  pricingVersion: number | null;
}

export interface SignalShare {
  key: string;
  label: string;
  pct: number;
  /** Raw count of scored prompts that tripped this signal — used to build an
   * exact "why this score" narrative rather than back-computing from a rounded pct. */
  count: number;
}

export interface ModelSplit {
  model: string;
  tokens: number;
  cost: number;
}

export interface VibeInfo {
  index: number;
  bucket: 'low' | 'medium' | 'high';
  structuredRatioPct: number;
  skillInvocations: number;
  mcpCalls: number;
  toolAssistedPct: number;
  reworkPct: number;
  vaguePct: number;
}

export interface LicenseView {
  licenseType: 'seat' | 'api';
  apiEquivalentValue: number;
  monthlyValueWorkdays: number;
  monthlyValueCalendar: number;
  activeDays: number;
  seatMonthlyUsd: number;
  seatSource: 'org' | 'benchmark';
  roiMultiple: number | null;
  /** Display-safe capped string for roiMultiple (e.g. "2.4x" or "5x+") — use this, not roiMultiple, for the headline. */
  roiMultipleDisplay: string | null;
  utilizationPct: number | null;
  /** Volume-only band. Prefer usageReading — it also accounts for quality, this doesn't. */
  leverageBand: 'high' | 'healthy' | 'room-to-use-more' | null;
  /**
   * A single honest usage read combining volume (roiMultiple) with quality signals
   * (avgScore, rework/vague rates) — use this for the headline, not leverageBand.
   * "positive" tone only when heavy usage is backed by strong quality. Null when
   * there's no reliable projection or the org isn't seat-billed.
   */
  usageReading: { label: string; tone: 'positive' | 'neutral' | 'caution'; detail: string } | null;
  promptsPerActiveDay: number;
  tokensPerActiveDay: number;
  /** False when there's too little data (< 5 active days) for the monthly projection
   * to be meaningful — the UI should hide projection-derived figures in that case. */
  projectionReliable: boolean;
}

export interface CapabilityUsage {
  skills: number;
  mcp: number;
  planMode: number;
  acceptEdits: number;
  subagents: number;
  taskPlanning: number;
  webResearch: number;
  toolCalls: number;
  editAcceptanceRate: number | null;
  distinctMcpServers: number;
}

export interface PromptTypeMix {
  debugging: number;
  codeGen: number;
  refactor: number;
  review: number;
  explain: number;
  other: number;
}

export interface SkillTier {
  score: number;
  tier: 'starting' | 'building' | 'strong' | 'expert';
  label: string;
}

export interface PromptReport {
  range: { from: string; to: string };
  consent: { consented: boolean; needsReconsent: boolean; currentVersion: string };
  collector: {
    connected: boolean;
    lastSeenAt: string | null;
    lastFour: string | null;
    /**
     * Which collector release this machine last reported with. Nothing on a laptop
     * updates itself, so a stale version is invisible unless we say so — and since
     * the VPN gate, out of date means "still reports from inside customer networks".
     */
    installedVersion: string | null;
    latestVersion: string | null;
    outOfDate: boolean;
    lastReportedAt: string | null;
  };
  totals: {
    prompts: number;
    sessions: number;
    tokens: number;
    cost: number;
    good: number;
    ok: number;
    poor: number;
    avgScore: number;
  };
  daily: DailyPoint[];
  signals: SignalShare[];
  vibe: VibeInfo;
  modelSplit: ModelSplit[];
  coaching: { tips: string[]; source: 'ai' | 'heuristic'; generatedAt: string | null };
  pricing: {
    currentVersion: number | null;
    versionsUsed: Array<{ version: number; effectiveFrom: string; note: string | null }>;
  };
  license: LicenseView;
  capabilities: CapabilityUsage;
  promptTypes: PromptTypeMix;
  skillTier: SkillTier;
  hasData: boolean;
  /**
   * Efficiency signals. `cache` is always present — it comes from fields every
   * collector version has sent, so it works on historical data too. The rest are
   * null until that machine reports collector >= 1.5.0; there is no backfill, so
   * null means "not measured yet" and must never render as a zero.
   */
  cache: CacheEfficiency;
  contextLoss: ContextLoss | null;
  sessionShape: SessionShape | null;
  concurrency: ConcurrencyView | null;
  pace: PaceView | null;
  modelTasks: ModelTaskRow[] | null;
  modelSuggestions: ModelSuggestion[];
  /** How many of the days in range actually carry schema-4 data — lets the UI
   * disclose a partial total (e.g. mid-range collector upgrade) instead of
   * presenting the efficiency-card sums as if they cover the whole range. */
  efficiencyCoverage: { reporting: number; total: number };
}

/**
 * A lead's view of ONE team member (click-through from the Team members
 * table). Deliberately the subset of `PromptReport` with no `consent`, no
 * `collector` token details, no `coaching`, and no `vibe` — see the backend
 * doc comment on `MemberDetailReport` for why each is excluded.
 */
export interface MemberDetailReport {
  member: { name: string; login: string };
  range: { from: string; to: string };
  totals: PromptReport['totals'];
  daily: DailyPoint[];
  signals: SignalShare[];
  modelSplit: ModelSplit[];
  pricing: PromptReport['pricing'];
  license: LicenseView;
  capabilities: CapabilityUsage;
  promptTypes: PromptTypeMix;
  skillTier: SkillTier;
  hasData: boolean;
  cache: CacheEfficiency;
  contextLoss: ContextLoss | null;
  sessionShape: SessionShape | null;
  concurrency: ConcurrencyView | null;
  pace: PaceView | null;
  modelTasks: ModelTaskRow[] | null;
  modelSuggestions: ModelSuggestion[];
  efficiencyCoverage: { reporting: number; total: number };
}

export interface TeamMemberRow {
  userId: number;
  name: string;
  login: string;
  prompts: number;
  avgScore: number;
  /** null entries = days with nothing scored; the sparkline skips them. */
  trend: (number | null)[];
  toolAssistedPct: number;
  focus: string;
  /** Where this member's tokens went. Null = their collector hasn't reported it yet. */
  cacheHitPct: number;
  contextLossTokens: number | null;
  avgSessionPrompts: number | null;
  maxConcurrent: number | null;
}

export interface TeamReport {
  range: { from: string; to: string };
  teamAvgTrend: { day: string; avgScore: number | null }[];
  teamToolAdoptionPct: number;
  signals: SignalShare[];
  /** Server-paged + searched — this is ONE PAGE, not the whole team. Every other
   * field here (trend, signals, sinks, suggestions, adoption %) still covers the
   * full team regardless of the page/search applied to this list. */
  members: TeamMemberRow[];
  /** Count matching the current search (or the whole team with no search) — the
   * pagination denominator, not `members.length`. */
  membersTotal: number;
  teamModelSplit: ModelSplit[];
  teamCacheHitPct: number;
  teamTokenSinks: TokenSink[];
  teamModelSuggestions: ModelSuggestion[];
  efficiencyCoverage: { reporting: number; total: number };
  /** Whole-team cache-health counts (every member, regardless of the `members`
   * page/search above) — the "Team coaching focus" panel's real denominator. */
  lowCacheMembers: { count: number; shortSessionCount: number };
}

export interface TokenSink {
  key: string;
  label: string;
  tokens: number;
  costUsd: number;
  pct: number;
}

// --- Efficiency signals ------------------------------------------------------

export interface CacheEfficiency {
  read: number;
  write: number;
  fresh: number;
  hitRatePct: number;
  savedUsd: number;
  verdict: 'healthy' | 'partial' | 'investigate';
}

export interface ContextLoss {
  compactions: number;
  /** Ran out of room mid-task — the number worth acting on. */
  auto: number;
  /** Deliberate. Reported separately so it isn't read as a problem. */
  manual: number;
  droppedTokens: number;
  costUsd: number;
  minutes: number;
  avgPreTokens: number;
  sessionsCompacted: number;
}

export interface SessionShape {
  sessions: number;
  sizeBuckets: { s1_5: number; s6_20: number; s21_100: number; s100plus: number };
  durationBuckets: { lt15m: number; m15_60: number; h1_4: number; h4plus: number };
  shortSessionPct: number;
}

export interface ConcurrencyView {
  maxConcurrent: number;
  daysWithOverlap: number;
  activeDays: number;
  switches: number;
  switchesUnder5m: number;
  rapidSwitchPct: number;
}

export interface PaceView {
  gapBuckets: { lt10s: number; s10_60: number; m1_5: number; m5_30: number; gt30m: number };
  total: number;
  immediatePct: number;
}

export interface ModelTaskRow {
  model: string;
  mix: PromptTypeMix;
  prompts: number;
  tokens: number;
  cost: number;
}

export interface ModelSuggestion {
  kind: 'downgrade' | 'upgrade' | 'prompt-quality';
  model: string;
  prompts: number;
  detail: string;
  monthlySavingUsd: number | null;
}

export interface TokenStatus {
  exists: boolean;
  lastFour: string | null;
  lastSeenAt: string | null;
}

export interface ConsentStatus {
  consented: boolean;
  version: string;
  currentVersion: string;
  needsReconsent: boolean;
  consentedAt: string | null;
}
