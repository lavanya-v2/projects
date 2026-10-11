/* eslint-disable @typescript-eslint/no-explicit-any */
import { Op } from 'sequelize';
import { ClaudeUsageDaily, ClaudeUsageMetrics } from '../../../models/ClaudeUsageDaily';
import { ClaudeUsageCoaching } from '../../../models/ClaudeUsageCoaching';
import { User } from '../../../models/User';
import { Project } from '../../../models/Project';
import { AccountTeamMember } from '../../../models/AccountTeamMember';
import { TeamMember } from '../../../models/TeamMember';
import { getAccessibleProjectIds } from '../../../common/projectAccess';
import { config } from '../../../config';
import { collectorAuthService } from './collectorAuthService';
import { pricingService } from './pricingService';
import { monitoredOrgService } from './monitoredOrgService';
import {
    computeCostWithRates,
    computeModelCost,
    rateForModel,
    configRateSet,
    totalTokens,
    avgScore as dayAvgScore,
    vibeIndex,
    vibeBucket,
    cacheStats,
    cacheSavings,
} from './promptQualityService';

/**
 * Assembles the member + team prompt-effectiveness reports from the content-free
 * daily rows. All interpretation (cost, scoring, vibe, coaching) is server-side.
 */

export interface DailyPoint {
    day: string;
    /** null when nothing was scored that day — a gap in the chart, not a score of 0. */
    avgScore: number | null;
    good: number;
    ok: number;
    poor: number;
    tokens: number;
    cost: number;
    pricingVersion: number | null;
}
/** `count` is the raw number of scored prompts that tripped this signal — kept
 * alongside `pct` so the frontend can build an exact "why this score" narrative
 * (e.g. "no_context fired on 5 of 12 prompts") without back-computing from a
 * rounded percentage. */
export interface SignalShare { key: string; label: string; pct: number; count: number }
/** cost is an API-list-price estimate for this model's tokens over the range — not a bill. */
export interface ModelSplit { model: string; tokens: number; cost: number }
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
/**
 * The VALUE view (ADDENDUM 6). Reframes the API list-price dollar figure — which is
 * NOT a bill under a corporate seat license — as leverage/ROI vs a seat cost. Token
 * counts are exact; the dollar value and seat cost are estimates (seat is often an
 * assumed benchmark, hence `seatSource`). Never present these to a customer as spend.
 */
export interface LicenseView {
    licenseType: 'seat' | 'api';
    /** What this usage would cost at API list prices over the selected range. Not a bill. */
    apiEquivalentValue: number;
    /** Projected monthly value from the trailing daily average (21 workdays and 30 days). */
    monthlyValueWorkdays: number;
    monthlyValueCalendar: number;
    activeDays: number;
    seatMonthlyUsd: number;
    seatSource: 'org' | 'benchmark';
    /** Seat-license only: monthly value ÷ seat cost. Null for api-billed orgs. */
    roiMultiple: number | null;
    /**
     * ADDENDUM 18: display-safe string for roiMultiple, capped at ROI_DISPLAY_CAP so a
     * heavy user's raw multiple (e.g. 26.8x) doesn't dominate the UI — past the cap the
     * number stops being informative and just reads as alarming. Full precision below
     * the cap (e.g. "2.4x"), else "{cap}x+" (e.g. "5x+"). Null mirrors roiMultiple.
     */
    roiMultipleDisplay: string | null;
    /** Seat-license only: capped at 999% so value≫seat doesn't render silly numbers. */
    utilizationPct: number | null;
    /** Volume-only band (roiMultiple thresholds). Kept for back-compat; UI should prefer usageReading. */
    leverageBand: 'high' | 'healthy' | 'room-to-use-more' | null;
    /**
     * ADDENDUM 18v2: a single honest read of usage, combining VOLUME (roiMultiple) with
     * the QUALITY signals we already compute (avgScore, rework/vague rates) — token
     * volume alone says nothing about whether that usage was effective, so "positive"
     * tone is only ever earned when both are true. Null when there's no reliable
     * projection or the org isn't seat-billed (nothing meaningful to say yet).
     */
    usageReading: { label: string; tone: 'positive' | 'neutral' | 'caution'; detail: string } | null;
    /** No-dollar intensity signals. */
    promptsPerActiveDay: number;
    tokensPerActiveDay: number;
    /**
     * ADDENDUM 17 item 1: the monthly projection (and everything derived from it —
     * roiMultiple, utilizationPct) is a linear extrapolation from the trailing daily
     * average. With very few active days, that amplifies noise into a large, alarming
     * dollar figure (e.g. 2 days of pilot usage → "$1,939/mo"). False below
     * MIN_DAYS_FOR_PROJECTION active days — the UI should hide the projection-derived
     * figures and show only the exact, non-extrapolated ones (apiEquivalentValue,
     * promptsPerActiveDay/tokensPerActiveDay) until there's enough signal.
     */
    projectionReliable: boolean;
}

const MIN_DAYS_FOR_PROJECTION = 5;
/** ADDENDUM 18: ceiling for the display-safe roiMultiple string — see roiMultipleDisplay. */
const ROI_DISPLAY_CAP = 5;

/**
 * Good-practice capability usage (ADDENDUM 7). All derived from data already collected
 * (structure counts + builtinTools tallies) — no collector change. Encouraging, not punitive;
 * a zero is a "try it" nudge. RAG-as-such isn't captured, so it's absent (webResearch is the
 * closest measurable proxy). Every value is a count over the selected range.
 */
export interface CapabilityUsage {
    skills: number;
    mcp: number;
    planMode: number;
    acceptEdits: number;
    subagents: number;
    taskPlanning: number;
    webResearch: number;
    toolCalls: number;
    /**
     * ADDENDUM 9 — ported from the colleague's analysis tool as a COUNT/rate, never
     * server names or edit content. `editAcceptanceRate` is null when no schemaVersion>=3
     * rows are in range (older collectors don't send it) so the UI can distinguish
     * "no data" from "0%". `distinctMcpServers` is the PEAK single-day count (servers
     * aren't named, so cross-day dedup isn't possible — summing would double-count).
     */
    editAcceptanceRate: number | null;
    distinctMcpServers: number;
}

/** Prompt-category tallies (ADDENDUM 9) — counts only, never the prompt text itself. */
export interface PromptTypeMix {
    debugging: number;
    codeGen: number;
    refactor: number;
    review: number;
    explain: number;
    other: number;
}

/**
 * A single-glance "skill tier" (ADDENDUM 9), computed server-side from signals we
 * already have (avg score, structured-help ratio, vibe index, edit acceptance) —
 * no new collector data required. Encouraging framing, not a ranking against peers.
 */
export interface SkillTier {
    score: number; // 0-100
    tier: 'starting' | 'building' | 'strong' | 'expert';
    label: string;
}

/**
 * Prompt-caching efficiency (ADDENDUM 21). Needs no collector change — cache_read
 * and cache_write have been on the wire since the first release, so this is
 * populated for every historical row, unlike the schema-4 blocks below.
 *
 * `hitRate` is over CONTEXT tokens (read + write + fresh input) — output is
 * generated, never cached, and counting it would dilute the number into noise.
 */
export interface CacheEfficiency {
    read: number;
    write: number;
    fresh: number;
    hitRatePct: number;
    savedUsd: number;
    verdict: 'healthy' | 'partial' | 'investigate';
}

/**
 * Context lost to compaction (schema 4). `auto` is the number that matters: it
 * means the conversation ran out of room mid-task. `manual` is a deliberate act
 * and is reported separately precisely so it isn't read as a problem.
 */
export interface ContextLoss {
    compactions: number;
    auto: number;
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

/** One row of the model x prompt-type cross-tab, with what that model actually cost. */
export interface ModelTaskRow {
    model: string;
    mix: PromptTypeMix;
    prompts: number;
    tokens: number;
    cost: number;
}

/**
 * A model-fit suggestion. Derived server-side rather than in the UI so the team
 * view can reuse the identical rule set — two screens disagreeing about which
 * model to use would be worse than not suggesting at all.
 */
export interface ModelSuggestion {
    kind: 'downgrade' | 'upgrade' | 'prompt-quality';
    model: string;
    prompts: number;
    detail: string;
    monthlySavingUsd: number | null;
}

export interface PromptReport {
    range: { from: string; to: string };
    consent: { consented: boolean; needsReconsent: boolean; currentVersion: string };
    collector: {
        connected: boolean;
        lastSeenAt: string | null;
        lastFour: string | null;
    } & CollectorVersionStatus;
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
    // Which cost model(s) priced this range — historical rows are frozen to the
    // version stamped at ingest, so this makes the formula-used transparent.
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
     * ADDENDUM 21 efficiency signals.
     *
     * `cache` is always present (derived from fields every collector has sent).
     * The other four are null when no row in range carries schema-4 data, which
     * is the forward-only contract: these were never backfilled, so the UI must
     * say "not measured yet" rather than render a confident zero. Mirrors the
     * existing editAcceptanceRate null-means-no-data convention.
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
     * presenting the efficiency-card sums as if they cover the whole range.
     * Mirrors TeamReport's own `efficiencyCoverage`. */
    efficiencyCoverage: { reporting: number; total: number };
}

/**
 * A lead's view of ONE team member (ADDENDUM 24) — click-through from the Team
 * members table. Deliberately the subset of `PromptReport` that is a pure
 * function of (userId, from, to): no `consent` (the target's own privacy opt-in
 * choice, not a lead's business), no `collector` token/lastFour (a fragment of
 * the target's own bearer credential), no `coaching` (AI tips are private
 * coaching, not for a lead to read), no `vibe` (explicitly private to the
 * member — see the note on `getTeamReport` below). Built by
 * `getMemberDetailForLead`, which shares `computeUsageCore` with `getMyReport`
 * so this can never silently drift out of sync with the self-service report.
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

/**
 * Which collector release this person's machine is actually running.
 *
 * Nothing on an engineer's laptop updates itself — a machine that never re-runs the
 * install command keeps its old behaviour indefinitely, and until now nothing said
 * so. That gap became material with the VPN gate: an out-of-date collector is the
 * difference between reporting from inside a customer network and not.
 */
export interface CollectorVersionStatus {
    /** Version last seen reporting, or null if this person has never reported. */
    installedVersion: string | null;
    /** What the server is currently handing out, or null if it cannot be read. */
    latestVersion: string | null;
    outOfDate: boolean;
    /** When the version above was last seen, so "out of date" can be dated. */
    lastReportedAt: string | null;
}

/**
 * Compare the most recent row's collector version against the release the server
 * is actually serving — read from collector.js itself, never a hardcoded copy
 * (see collectorAuthService.currentCollectorVersion).
 *
 * Deliberately conservative in both directions: an unrecognised version, or a
 * release we cannot read, is NOT reported as out of date. Nagging someone over a
 * version we cannot parse is worse than staying quiet.
 */
function collectorVersionStatus(rows: ClaudeUsageDaily[]): CollectorVersionStatus {
    const latestVersion = collectorAuthService.currentCollectorVersion();
    const withVersion = rows.filter((r) => r.collectorVersion && r.receivedAt);
    if (!withVersion.length || !latestVersion) {
        return {
            installedVersion: withVersion.length ? (withVersion[withVersion.length - 1].collectorVersion as string) : null,
            latestVersion,
            outOfDate: false,
            lastReportedAt: null,
        };
    }
    const newest = withVersion.reduce((a, b) =>
        (new Date(b.receivedAt as any).getTime() > new Date(a.receivedAt as any).getTime() ? b : a));
    const installedVersion = newest.collectorVersion as string;
    const known = config.collector.integrity.knownCollectorVersions as readonly string[];
    const outOfDate = known.includes(installedVersion) && installedVersion !== latestVersion;
    return {
        installedVersion,
        latestVersion,
        outOfDate,
        lastReportedAt: newest.receivedAt ? new Date(newest.receivedAt as any).toISOString() : null,
    };
}

export interface TeamMemberRow {
    userId: number;
    name: string;
    login: string;
    prompts: number;
    avgScore: number;
    /** null entries = days with nothing scored; the sparkline breaks rather than dips. */
    trend: (number | null)[];
    toolAssistedPct: number;
    focus: string;
    /**
     * ADDENDUM 21 efficiency columns. These describe WHERE A MEMBER'S TOKENS WENT,
     * not how well they worked — the table stays sorted by avgScore so it is not
     * reframed as an efficiency leaderboard. `cacheHitPct` is present for every
     * member (no collector change); the other three are null until that member's
     * machine reports schema 4.
     */
    cacheHitPct: number;
    contextLossTokens: number | null;
    avgSessionPrompts: number | null;
    maxConcurrent: number | null;
}
export interface TeamReport {
    range: { from: string; to: string };
    /** `avgScore` is null on days where nothing was scored — a gap, not a zero. */
    teamAvgTrend: { day: string; avgScore: number | null }[];
    teamToolAdoptionPct: number;
    signals: SignalShare[];
    /** ADDENDUM 24: server-side paged + searched — this is ONE PAGE, not the whole team.
     * Every other field on this response (trend, signals, sinks, suggestions, adoption %)
     * is still computed from the FULL team regardless of the page/search applied here. */
    members: TeamMemberRow[];
    /** Count of members matching the current search (or the whole team if no search) —
     * the denominator for the members table's pagination, not `members.length`. */
    membersTotal: number;
    /** Team-wide model usage (tokens + estimated cost), aggregated — no per-member breakdown. */
    teamModelSplit: ModelSplit[];
    /** ADDENDUM 21: team cache health. Always available. */
    teamCacheHitPct: number;
    /**
     * Ranked token sinks across the team, most expensive first. The point of the
     * team view: which shared habit is actually costing money.
     */
    teamTokenSinks: Array<{ key: string; label: string; tokens: number; costUsd: number; pct: number }>;
    /** Team-wide model-fit suggestions, from the same rules as the personal view. */
    teamModelSuggestions: ModelSuggestion[];
    /** How many members are reporting schema-4 data, so the UI can caveat partial coverage. */
    efficiencyCoverage: { reporting: number; total: number };
    /**
     * Whole-team cache-health counts, computed over EVERY member regardless of the
     * `members` page/search above — the "team coaching focus" panel needs a real
     * team-wide count, and `members` can no longer be assumed to hold everyone now
     * that it's server-paged (ADDENDUM 24).
     */
    lowCacheMembers: { count: number; shortSessionCount: number };
}

const SIGNAL_LABELS: Record<string, string> = {
    no_context: 'No context provided',
    rework: 'Rapid re-prompt (rework)',
    very_short: 'Very short / underspecified',
    vague: 'Vague command',
    unclear_referent: 'Unclear referent',
    short: 'Short',
};

function defaultRange(from?: string, to?: string): { from: string; to: string } {
    // Fall back to the last 14 days ending today (UTC). Callers may override.
    const end = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : new Date().toISOString().slice(0, 10);
    let start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : '';
    if (!start) {
        const d = new Date(end + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 13);
        start = d.toISOString().slice(0, 10);
    }
    return { from: start, to: end };
}

/** Deterministic, explainable coaching used when no AI tips are cached. */
export function heuristicTips(agg: {
    noContextPct: number;
    reworkPct: number;
    vaguePct: number;
    structuredRatioPct: number;
    avgScore: number;
}): string[] {
    const tips: string[] = [];
    if (agg.noContextPct >= 20) {
        tips.push(
            `Add context up front (${agg.noContextPct}% of your prompts had none). Paste the failing file path, the error text, or the function name instead of "it's broken."`,
        );
    }
    if (agg.reworkPct >= 12) {
        tips.push(
            `You re-prompt quickly after a reply ${agg.reworkPct}% of the time — usually rework. Spend one extra line specifying the acceptance criteria before you send.`,
        );
    }
    if (agg.structuredRatioPct < 55) {
        tips.push(
            `You rarely lean on skills/MCP for repetitive work. Try a skill like /security-review before PRs and the code-search skill for cross-file changes.`,
        );
    }
    if (agg.vaguePct >= 12) {
        tips.push(
            `${agg.vaguePct}% of prompts were vague commands. State the goal and the expected outcome in the first message.`,
        );
    }
    if (!tips.length) {
        tips.push('Strong prompting overall — keep giving context up front and leaning on skills/tools.');
    }
    return tips.slice(0, 3);
}

/**
 * The set of user ids whose reports the caller may see for the team view.
 *   - superuser / admin  → everyone who has collector data
 *   - manager / lead      → users on a project within the caller's access scope
 *                           (resolved via team_members email ↔ users login)
 * Always includes the caller. Members never reach this (route-gated).
 */
export async function resolveVisibleUserIds(reqUser: any): Promise<number[]> {
    const privileged = reqUser?.role === 'SUPERUSER' || reqUser?.roleName === 'admin';
    if (privileged) {
        const rows = await ClaudeUsageDaily.findAll({ attributes: ['userId'], group: ['userId'] });
        return rows.map((r) => r.userId);
    }
    return resolveProjectScopedUserIds(reqUser);
}

/**
 * The project-access-scoped resolution pipeline, WITHOUT the superuser/admin
 * "everyone" bypass — factored out of resolveVisibleUserIds so it can be reused
 * unconditionally (even for superusers) by resolveAuditVisibleUserIds below.
 */
async function resolveProjectScopedUserIds(reqUser: any): Promise<number[]> {
    const ids = new Set<number>([reqUser?.id].filter((x) => typeof x === 'number'));
    const accessible = [...(await getAccessibleProjectIds(reqUser.id))];
    if (!accessible.length) return [...ids];

    // Account-wide team members also count — collect the accounts of accessible projects.
    const projects = await Project.findAll({ where: { id: { [Op.in]: accessible } }, attributes: ['id', 'accountId'] });
    const accountIds = [...new Set(projects.map((p) => p.accountId).filter((x): x is number => x != null))];

    const or: any[] = [{ projectId: { [Op.in]: accessible } }];
    if (accountIds.length) or.push({ projectId: null, accountId: { [Op.in]: accountIds } });
    const assocs = await AccountTeamMember.findAll({ where: { [Op.or]: or }, attributes: ['teamMemberId'] });
    const teamMemberIds = [...new Set(assocs.map((a) => a.teamMemberId))];
    if (!teamMemberIds.length) return [...ids];

    const members = await TeamMember.findAll({
        where: { id: { [Op.in]: teamMemberIds } },
        attributes: ['email', 'partnerEmailId'],
    });
    const emails = [
        ...new Set(
            members
                .flatMap((m) => [(m as any).email, (m as any).partnerEmailId])
                .filter((e: unknown): e is string => typeof e === 'string' && e.trim().length > 0)
                .map((e) => e.trim()),
        ),
    ];
    if (!emails.length) return [...ids];

    const userOr = emails.flatMap((e) => [{ userId: { [Op.iLike]: e } }, { email: { [Op.iLike]: e } }]);
    const users = await User.findAll({ where: { [Op.or]: userOr }, attributes: ['id'] });
    for (const u of users) ids.add(u.id);
    return [...ids];
}

/**
 * Visible-user resolution for the ingest audit log (ADDENDUM 11 Phase 3) — a
 * deliberate deviation from resolveVisibleUserIds's usual "superuser sees
 * everyone" norm. Even a superuser only sees rows for users tagged to projects
 * THEY personally have UserPermission grants for, never a company-wide bypass.
 */
export async function resolveAuditVisibleUserIds(reqUser: any): Promise<number[]> {
    return resolveProjectScopedUserIds(reqUser);
}

/**
 * ADDENDUM 18v2: a single honest usage read. Volume (roiMultiple) alone cannot
 * justify a "good" verdict — heavy token use is just as consistent with inefficient,
 * low-quality prompting as with high-value work. A positive tone is only earned when
 * heavy volume is ALSO backed by the quality signals this report already computes
 * (avgScore, rework/vague rates). Otherwise the read stays purely descriptive.
 */
function buildUsageReading(input: {
    projectionReliable: boolean;
    roiMultiple: number | null;
    roiMultipleDisplay: string | null;
    avgScore: number;
    reworkPct: number;
    vaguePct: number;
}): LicenseView['usageReading'] {
    const { projectionReliable, roiMultiple, roiMultipleDisplay, avgScore, reworkPct, vaguePct } = input;
    if (!projectionReliable || roiMultiple == null || roiMultipleDisplay == null) return null;

    const heavy = roiMultiple >= 3;
    const moderate = roiMultiple >= 1;
    const qualityWeak = avgScore < 55 || reworkPct >= 20 || vaguePct >= 20;
    const qualityStrong = avgScore >= 70 && reworkPct < 12 && vaguePct < 12;

    if (heavy && qualityWeak) {
        return {
            label: 'Heavy usage — worth a look',
            tone: 'caution',
            detail: `High token volume (about ${roiMultipleDisplay} your seat's cost) alongside a lower prompt score and more rework/vague prompts — this may be inefficient usage rather than high-value work. Check the coaching tips below.`,
        };
    }
    if (heavy && qualityStrong) {
        return {
            label: 'Heavy, effective usage',
            tone: 'positive',
            detail: `High token volume (about ${roiMultipleDisplay} your seat's cost) paired with a strong prompt score and low rework — this reads as genuinely high-value use, not just high volume.`,
        };
    }
    if (heavy) {
        return {
            label: 'Heavy usage',
            tone: 'neutral',
            detail: `Using about ${roiMultipleDisplay} your seat's cost in token volume. This reflects activity level, not effectiveness on its own — see your score and skill tier for that.`,
        };
    }
    if (moderate) {
        return {
            label: 'Moderate usage',
            tone: 'neutral',
            detail: `Using about ${roiMultipleDisplay} your seat's cost in token volume.`,
        };
    }
    return {
        label: 'Light usage',
        tone: 'neutral',
        detail: `Using about ${roiMultipleDisplay} your seat's cost so far — plenty of room to lean on Claude more.`,
    };
}

/**
 * Build the VALUE view. Projects the trailing daily-average value to a month and,
 * for a seat license, expresses it as leverage (ROI) vs the seat cost. Seat cost is
 * the org override if set, else a global benchmark (labeled via `seatSource`).
 */
async function buildLicenseView(input: {
    orgUuid: string | null;
    apiEquivalentValue: number;
    /** Days that reported at all. The right denominator for cost/token rates: a day of
     *  pure assistant output (session resumed across midnight) still costs money. */
    activeDays: number;
    /** Subset of `activeDays` that recorded at least one prompt. The right denominator
     *  for prompt rates — otherwise those days dilute the average toward zero. */
    promptDays: number;
    prompts: number;
    tokens: number;
    avgScore: number;
    reworkPct: number;
    vaguePct: number;
}): Promise<LicenseView> {
    const { orgUuid, apiEquivalentValue, activeDays, promptDays, prompts, tokens, avgScore, reworkPct, vaguePct } = input;
    const lic = await monitoredOrgService.getLicense(orgUuid);
    const seat = lic.seatMonthlyUsd > 0 ? lic.seatMonthlyUsd : 0;

    const dailyAvg = activeDays > 0 ? apiEquivalentValue / activeDays : 0;
    const monthlyValueWorkdays = Math.round(dailyAvg * 21 * 100) / 100;
    const monthlyValueCalendar = Math.round(dailyAvg * 30 * 100) / 100;
    const projectionReliable = activeDays >= MIN_DAYS_FOR_PROJECTION;

    let roiMultiple: number | null = null;
    let roiMultipleDisplay: string | null = null;
    let utilizationPct: number | null = null;
    let leverageBand: LicenseView['leverageBand'] = null;
    if (lic.licenseType === 'seat' && seat > 0) {
        roiMultiple = Math.round((monthlyValueWorkdays / seat) * 10) / 10;
        roiMultipleDisplay = roiMultiple >= ROI_DISPLAY_CAP ? `${ROI_DISPLAY_CAP}x+` : `${roiMultiple}x`;
        utilizationPct = Math.min(999, Math.round((monthlyValueWorkdays / seat) * 100));
        leverageBand = roiMultiple >= 3 ? 'high' : roiMultiple >= 1 ? 'healthy' : 'room-to-use-more';
    }

    const usageReading = buildUsageReading({ projectionReliable, roiMultiple, roiMultipleDisplay, avgScore, reworkPct, vaguePct });

    return {
        licenseType: lic.licenseType,
        apiEquivalentValue,
        monthlyValueWorkdays,
        monthlyValueCalendar,
        activeDays,
        seatMonthlyUsd: lic.seatMonthlyUsd,
        seatSource: lic.source,
        roiMultiple,
        roiMultipleDisplay,
        utilizationPct,
        leverageBand,
        usageReading,
        promptsPerActiveDay: promptDays > 0 ? Math.round((prompts / promptDays) * 10) / 10 : 0,
        tokensPerActiveDay: activeDays > 0 ? Math.round(tokens / activeDays) : 0,
        projectionReliable,
    };
}

export interface FlaggedRow {
    userId: number;
    login: string;
    name: string;
    day: string;
    flags: Array<{ code: string; detail: string; severity: string }>;
    avgScore: number;
    totalPrompts: number;
    tokens: number;
    vibeIndex: number;
    receivedAt: string | null;
    /**
     * What triggered this machine's report: 'scheduler' (weekday OS job), 'startup'
     * (login only), 'hook' (Claude session end only), or null for collectors older
     * than the scheduler rollout. Anything other than 'scheduler' means this person
     * can silently miss days, which a missing row alone would never reveal.
     */
    triggerTier: string | null;
}

/**
 * Skill tier (ADDENDUM 9): a single 0-100 score + encouraging label from signals we
 * already compute — no new collector data. Weighted: avg score (40), structured-help
 * ratio (30), inverse vibe index (20), edit acceptance when available (10; if unknown,
 * that slice is dropped and the other three are rescaled to 100 so tier isn't punished
 * for missing data from an older collector).
 */
function computeSkillTier(input: {
    avgScore: number;
    structuredRatioPct: number;
    vibeIdx: number;
    editAcceptanceRate: number | null;
}): SkillTier {
    const { avgScore, structuredRatioPct, vibeIdx, editAcceptanceRate } = input;
    const parts: Array<{ value: number; weight: number }> = [
        { value: Math.min(avgScore, 100), weight: 40 },
        { value: Math.min(structuredRatioPct, 100), weight: 30 },
        { value: 100 - Math.min(vibeIdx, 100), weight: 20 },
    ];
    if (editAcceptanceRate != null) parts.push({ value: Math.min(editAcceptanceRate, 100), weight: 10 });
    const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
    const raw = parts.reduce((s, p) => s + (p.value / 100) * p.weight, 0);
    const score = Math.round((raw / totalWeight) * 100);

    const tier: SkillTier['tier'] = score >= 80 ? 'expert' : score >= 60 ? 'strong' : score >= 40 ? 'building' : 'starting';
    const label = {
        expert: 'Expert practice',
        strong: 'Strong practice',
        building: 'Building habits',
        starting: 'Getting started',
    }[tier];
    return { score, tier, label };
}

// ---------------------------------------------------------------------------
// ADDENDUM 21 — efficiency signals.
//
// Everything below answers one question: where do tokens go without producing
// results? Framing throughout is coaching, not scoring. None of these feed the
// skill tier or the vibe index, deliberately: an engineer running three sessions
// at once is not worse at their job than one who runs a single session, and a
// number that quietly became part of a rating would stop being honest.
// ---------------------------------------------------------------------------

const CACHE_HEALTHY_PCT = 85;
const CACHE_PARTIAL_PCT = 60;
/** Workdays used to project a per-range saving to "per month" — matches LicenseView. */
const WORKDAYS_PER_MONTH = 21;
/** Below this many prompts on a model, a mix is too thin to suggest anything from. */
const MIN_PROMPTS_FOR_SUGGESTION = 20;
/** Share of a model's prompts that must be read-only work before suggesting a downgrade. */
const DOWNGRADE_SHARE_PCT = 25;

/** Rough capability ordering, cheapest first. Prefix-matched, so dated ids resolve. */
const MODEL_TIERS: Array<{ prefix: string; tier: number; label: string }> = [
    { prefix: 'claude-haiku', tier: 1, label: 'Haiku' },
    { prefix: 'claude-3-5-haiku', tier: 1, label: 'Haiku' },
    { prefix: 'claude-sonnet', tier: 2, label: 'Sonnet' },
    { prefix: 'claude-3-7-sonnet', tier: 2, label: 'Sonnet' },
    { prefix: 'claude-opus', tier: 3, label: 'Opus' },
    { prefix: 'claude-fable', tier: 3, label: 'Fable' },
];

function modelTier(model: string): { tier: number; label: string } | null {
    const hit = MODEL_TIERS.filter((t) => model.startsWith(t.prefix))
        .sort((a, b) => b.prefix.length - a.prefix.length)[0];
    return hit ? { tier: hit.tier, label: hit.label } : null;
}

/** The cheapest known model one tier below `model`, resolved against models in use. */
function cheaperSibling(model: string): string | null {
    const here = modelTier(model);
    if (!here || here.tier <= 1) return null;
    const target = MODEL_TIERS.find((t) => t.tier === here.tier - 1);
    return target ? target.label : null;
}

function emptyMix(): PromptTypeMix {
    return { debugging: 0, codeGen: 0, refactor: 0, review: 0, explain: 0, other: 0 };
}

function mixTotal(m: PromptTypeMix): number {
    return m.debugging + m.codeGen + m.refactor + m.review + m.explain + m.other;
}

/**
 * Model-fit suggestions from the model x prompt-type cross-tab.
 *
 * Three rules, in priority order:
 *  1. A low average score on an expensive model is a PROMPT problem, not a model
 *     problem. Suggesting a cheaper model there would make the output worse and
 *     leave the real cause untouched, so this rule pre-empts the others.
 *  2. Read-only work (explain / review) on a top-tier model → suggest one tier
 *     down, priced.
 *  3. Build work (codeGen / debugging) on the cheapest tier → suggest one tier UP.
 *     This one costs money and is offered anyway: the retry loop on an
 *     under-powered model is usually longer than the saving.
 */
function buildModelSuggestions(
    rows: ModelTaskRow[],
    avgScoreByModel: Map<string, number>,
    overallAvgScore: number,
    activeDays: number,
): ModelSuggestion[] {
    const out: ModelSuggestion[] = [];
    for (const row of rows) {
        if (row.prompts < MIN_PROMPTS_FOR_SUGGESTION) continue;
        const tier = modelTier(row.model);
        if (!tier) continue;

        const scoreHere = avgScoreByModel.get(row.model);
        if (tier.tier >= 3 && scoreHere != null && scoreHere < overallAvgScore - 5) {
            out.push({
                kind: 'prompt-quality',
                model: row.model,
                prompts: row.prompts,
                detail: `Your ${tier.label} prompts average ${Math.round(scoreHere)}/100, below your overall ${Math.round(overallAvgScore)}. A low score on the most expensive model usually means the prompt was missing context, not that the model was wrong — fix the prompt before switching the model.`,
                monthlySavingUsd: null,
            });
            continue;
        }

        const readOnly = row.mix.explain + row.mix.review;
        const readOnlyPct = row.prompts > 0 ? (readOnly / row.prompts) * 100 : 0;
        const target = cheaperSibling(row.model);
        if (tier.tier >= 3 && target && readOnlyPct >= DOWNGRADE_SHARE_PCT) {
            // Price the share of this model's spend attributable to those prompts,
            // then the same share one tier down. Prompt-count share is the only
            // apportionment available — tokens are not broken down by prompt type.
            const share = readOnly / row.prompts;
            const spendHere = row.cost * share;
            const rates = configRateSet();
            const hereRate = rateForModel(row.model, rates);
            const targetModel = rows.find((r) => modelTier(r.model)?.label === target)?.model
                ?? `claude-${target.toLowerCase()}`;
            const targetRate = rateForModel(targetModel, rates);
            const ratio = hereRate.output > 0 ? targetRate.output / hereRate.output : 1;
            const savedInRange = Math.max(0, spendHere * (1 - ratio));
            const perMonth = activeDays > 0
                ? (savedInRange / activeDays) * WORKDAYS_PER_MONTH
                : savedInRange;
            out.push({
                kind: 'downgrade',
                model: row.model,
                prompts: readOnly,
                detail: `${readOnly} explain/review prompts went to ${tier.label}. These read existing code and describe it — ${target} handles them at the same quality.`,
                monthlySavingUsd: Math.round(perMonth * 100) / 100,
            });
            continue;
        }

        const buildWork = row.mix.codeGen + row.mix.debugging;
        if (tier.tier === 1 && buildWork / row.prompts > 0.5) {
            out.push({
                kind: 'upgrade',
                model: row.model,
                prompts: buildWork,
                detail: `${buildWork} code-generation/debugging prompts went to ${tier.label}. Moving these to Sonnet usually costs less overall — the retry loop on a smaller model runs longer than the saving.`,
                monthlySavingUsd: null,
            });
        }
    }
    return out;
}

/**
 * The shared aggregation core behind both `getMyReport` (self) and
 * `getMemberDetailForLead` (a lead viewing one team member) — ADDENDUM 24.
 *
 * Everything in here is a PURE function of (userId, from, to): no dependency
 * on who is asking. The four things that DO depend on who's asking — consent
 * status, collector/token identity, AI coaching tips, and the vibe-coding
 * index — are deliberately built OUTSIDE this function, by whichever caller
 * is allowed to see them (only `getMyReport`, today). `windowVibeIndex`,
 * `structuredRatioPct`, `toolAssistedPct`, `reworkPct`, `vaguePct` and
 * `skillInvocations`/`mcpCalls` are returned here only as INGREDIENTS —
 * `getMyReport` uses them to build its private `vibe` view; a lead-facing
 * caller must not surface them as a `vibe` object of its own.
 */
async function computeUsageCore(userId: number, from?: string, to?: string) {
    const range = defaultRange(from, to);

    const [rows, activePricing] = await Promise.all([
        ClaudeUsageDaily.findAll({
            where: { userId, day: { [Op.between]: [range.from, range.to] } },
            order: [['day', 'ASC']],
        }),
        pricingService.getActive(),
    ]);

    // Load the frozen pricing versions these rows were stamped with, so each
    // day is priced with the rates that applied at its ingest (not today's).
    const versionMap = await pricingService.getByIds(
        rows.map((r) => r.pricingVersionId).filter((x): x is number => x != null),
    );
    const fallbackRates = configRateSet();
    const versionsUsed = new Map<number, { version: number; effectiveFrom: string; note: string | null }>();

    const daily: DailyPoint[] = [];
    const totals = { prompts: 0, sessions: 0, tokens: 0, cost: 0, good: 0, ok: 0, poor: 0, scoreSum: 0, scored: 0 };
    const signalTotals = { no_context: 0, rework: 0, very_short: 0, vague: 0, unclear_referent: 0, short: 0 };
    const modelTokens: Record<string, number> = {};
    const modelCost: Record<string, number> = {};
    const struct = { skill: 0, mcp: 0, free: 0, toolAssist: 0 };
    const builtin: Record<string, number> = {};
    let orgUuid: string | null = null;
    // Plan-mode turns (schemaVersion >= 2). Falls back to the ExitPlanMode proxy
    // when no row in range carries the newer field (older collectors).
    let planTurns = 0;
    let acceptTurns = 0;
    let hasModeData = false;
    let editsAccepted = 0;
    let editsRejected = 0;
    let hasEditData = false;
    let peakDistinctMcpServers = 0;
    const promptTypeTotals: PromptTypeMix = { debugging: 0, codeGen: 0, refactor: 0, review: 0, explain: 0, other: 0 };

    // --- ADDENDUM 21 accumulators ---------------------------------------
    // cache* needs no schema-4 data and is summed for every row. The rest are
    // gated on has* flags so a range that predates collector 1.5.0 reports
    // null ("not measured") instead of a confident zero.
    const cacheAcc = { read: 0, write: 0, fresh: 0, savedUsd: 0 };
    const ctxAcc = { compactions: 0, auto: 0, manual: 0, dropped: 0, preSum: 0, ms: 0, sessionsCompacted: 0, costUsd: 0 };
    const sizeAcc = { s1_5: 0, s6_20: 0, s21_100: 0, s100plus: 0 };
    const durAcc = { lt15m: 0, m15_60: 0, h1_4: 0, h4plus: 0 };
    const gapAcc = { lt10s: 0, s10_60: 0, m1_5: 0, m5_30: 0, gt30m: 0 };
    const concAcc = { peak: 0, daysWithOverlap: 0, days: 0, switches: 0, under5m: 0 };
    const modelMix = new Map<string, PromptTypeMix>();
    let hasContextData = false;
    let hasSessionShape = false;
    let hasPaceData = false;
    let hasConcurrency = false;
    let hasModelTaskMix = false;
    // The collector sends all five schema-4 fields as one block (see
    // collector.js's "SCHEMA 4 efficiency signals"), so m.context's presence
    // is already the correct single proxy for "this day is schema-4".
    let reportingDays = 0;

    for (const row of rows) {
        const m = row.metrics;
        if (row.orgUuid) orgUuid = row.orgUuid;
        for (const [tool, n] of Object.entries(m.structure.builtinTools || {})) {
            builtin[tool] = (builtin[tool] || 0) + (n || 0);
        }
        if (m.structure.planModeTurns != null || m.structure.acceptEditsTurns != null) {
            hasModeData = true;
            planTurns += m.structure.planModeTurns || 0;
            acceptTurns += m.structure.acceptEditsTurns || 0;
        }
        if (m.structure.editsAccepted != null || m.structure.editsRejected != null) {
            hasEditData = true;
            editsAccepted += m.structure.editsAccepted || 0;
            editsRejected += m.structure.editsRejected || 0;
        }
        peakDistinctMcpServers = Math.max(peakDistinctMcpServers, m.structure.distinctMcpServers || 0);
        if (m.promptTypes) {
            (Object.keys(promptTypeTotals) as (keyof PromptTypeMix)[]).forEach(
                (k) => (promptTypeTotals[k] += m.promptTypes?.[k] || 0),
            );
        }
        const tokens = totalTokens(m);
        const pm = row.pricingVersionId != null ? versionMap.get(Number(row.pricingVersionId)) : undefined;
        const rates = pm ? pm.rates : fallbackRates;
        const cost = computeCostWithRates(m, rates);
        if (pm) {
            versionsUsed.set(pm.version, {
                version: pm.version,
                effectiveFrom: pm.effectiveFrom.toISOString(),
                note: pm.note,
            });
        }
        daily.push({
            day: row.day,
            avgScore: m.prompts.scored ? dayAvgScore(m) : null,
            good: m.scores.good,
            ok: m.scores.ok,
            poor: m.scores.poor,
            tokens,
            cost,
            pricingVersion: pm ? pm.version : null,
        });
        totals.prompts += m.prompts.total;
        totals.sessions += m.activity.sessions;
        totals.tokens += tokens;
        totals.cost += cost;
        totals.good += m.scores.good;
        totals.ok += m.scores.ok;
        totals.poor += m.scores.poor;
        totals.scoreSum += m.scores.sum;
        totals.scored += m.prompts.scored;
        (Object.keys(signalTotals) as (keyof typeof signalTotals)[]).forEach(
            (k) => (signalTotals[k] += (m.signals as any)[k] || 0),
        );
        for (const [model, t] of Object.entries(m.tokensByModel)) {
            modelTokens[model] = (modelTokens[model] || 0) + t.input + t.output + t.cache_write + t.cache_read;
            modelCost[model] = (modelCost[model] || 0) + computeModelCost(t, rateForModel(model, rates));
        }

        // --- ADDENDUM 21 ------------------------------------------------
        // Caching: priced with the SAME frozen rate set as the row's cost, so
        // "saved" and "cost" can never be quoted against different price lists.
        const cs = cacheStats(m);
        cacheAcc.read += cs.read;
        cacheAcc.write += cs.write;
        cacheAcc.fresh += cs.fresh;
        cacheAcc.savedUsd += cacheSavings(m, rates);

        if (m.context) {
            hasContextData = true;
            reportingDays += 1;
            ctxAcc.compactions += m.context.compactions;
            ctxAcc.auto += m.context.autoCompactions;
            ctxAcc.manual += m.context.manualCompactions;
            ctxAcc.dropped += m.context.droppedTokens;
            ctxAcc.preSum += m.context.preTokensSum;
            ctxAcc.ms += m.context.compactionMs;
            ctxAcc.sessionsCompacted += m.context.sessionsCompacted;
            // What the dropped context cost to re-establish. Charged at the
            // day's dominant model's INPUT rate: re-reading a rebuilt context
            // is a fresh (uncached) read, which is exactly the input rate.
            const dominant = Object.entries(m.tokensByModel)
                .sort((a, b2) => (b2[1].input + b2[1].output) - (a[1].input + a[1].output))[0];
            if (dominant) {
                ctxAcc.costUsd += (m.context.droppedTokens / 1e6) * rateForModel(dominant[0], rates).input;
            }
        }
        if (m.sessionShape) {
            hasSessionShape = true;
            sizeAcc.s1_5 += m.sessionShape.sizeBuckets.s1_5;
            sizeAcc.s6_20 += m.sessionShape.sizeBuckets.s6_20;
            sizeAcc.s21_100 += m.sessionShape.sizeBuckets.s21_100;
            sizeAcc.s100plus += m.sessionShape.sizeBuckets.s100plus;
            durAcc.lt15m += m.sessionShape.durationBuckets.lt15m;
            durAcc.m15_60 += m.sessionShape.durationBuckets.m15_60;
            durAcc.h1_4 += m.sessionShape.durationBuckets.h1_4;
            durAcc.h4plus += m.sessionShape.durationBuckets.h4plus;
        }
        if (m.concurrency) {
            hasConcurrency = true;
            concAcc.days += 1;
            // The PEAK across the range, not a sum: "3 at once" is a fact about
            // a moment, and adding those moments up would be meaningless.
            concAcc.peak = Math.max(concAcc.peak, m.concurrency.maxConcurrent);
            if (m.concurrency.maxConcurrent > 1) concAcc.daysWithOverlap += 1;
            concAcc.switches += m.concurrency.switches;
            concAcc.under5m += m.concurrency.switchesUnder5m;
        }
        if (m.pace) {
            hasPaceData = true;
            gapAcc.lt10s += m.pace.gapBuckets.lt10s;
            gapAcc.s10_60 += m.pace.gapBuckets.s10_60;
            gapAcc.m1_5 += m.pace.gapBuckets.m1_5;
            gapAcc.m5_30 += m.pace.gapBuckets.m5_30;
            gapAcc.gt30m += m.pace.gapBuckets.gt30m;
        }
        if (m.promptTypesByModel) {
            hasModelTaskMix = true;
            for (const [model, t] of Object.entries(m.promptTypesByModel)) {
                const acc = modelMix.get(model) || emptyMix();
                acc.debugging += t.debugging;
                acc.codeGen += t.codeGen;
                acc.refactor += t.refactor;
                acc.review += t.review;
                acc.explain += t.explain;
                acc.other += t.other;
                modelMix.set(model, acc);
            }
        }

        struct.skill += m.structure.skillInvocations;
        struct.mcp += m.structure.mcpCalls;
        struct.free += m.structure.freeTextTurns;
        struct.toolAssist += m.structure.toolAssistedTurns;
    }

    const scoredDen = totals.scored || 1;
    const avg = totals.scored ? Math.round((totals.scoreSum / totals.scored) * 10) / 10 : 0;
    const signals: SignalShare[] = (Object.keys(SIGNAL_LABELS) as string[])
        .map((k) => ({
            key: k,
            label: SIGNAL_LABELS[k],
            pct: Math.round(((signalTotals as any)[k] / scoredDen) * 100),
            count: (signalTotals as any)[k] || 0,
        }))
        .filter((s) => s.key !== 'short'); // 'short' overlaps 'very_short' in the UI

    const turns = struct.free + struct.toolAssist;
    const structuredRatioPct = turns
        ? Math.round(((struct.toolAssist + struct.skill + struct.mcp) / (turns + struct.skill + struct.mcp)) * 100)
        : 0;
    const toolAssistedPct = turns ? Math.round((struct.toolAssist / turns) * 100) : 0;
    const reworkPct = Math.round((signalTotals.rework / scoredDen) * 100);
    const vaguePct = Math.round((signalTotals.vague / scoredDen) * 100);
    const noContextPct = Math.round((signalTotals.no_context / scoredDen) * 100);

    // Vibe index over the whole window: rebuild a synthetic metrics blob of the sums.
    // An INGREDIENT only — see the doc comment above. Not every caller may expose it.
    const windowVibeIndex = vibeIndex({
        prompts: { total: totals.prompts, scored: totals.scored, acks: 0 },
        scores: { good: totals.good, ok: totals.ok, poor: totals.poor, sum: totals.scoreSum },
        signals: signalTotals,
        tokensByModel: {},
        activity: { sessions: totals.sessions, distinctProjects: 0 },
        structure: {
            skillInvocations: struct.skill,
            mcpCalls: struct.mcp,
            builtinTools: {},
            freeTextTurns: struct.free,
            toolAssistedTurns: struct.toolAssist,
        },
        schemaVersion: 1,
        collectorVersion: '0',
    } as ClaudeUsageMetrics);

    const modelSplit: ModelSplit[] = Object.entries(modelTokens)
        .map(([model, tokens]) => ({ model, tokens, cost: Math.round((modelCost[model] || 0) * 100) / 100 }))
        .sort((a, b) => b.tokens - a.tokens);

    // --- ADDENDUM 21 views ----------------------------------------------
    const cacheContext = cacheAcc.read + cacheAcc.write + cacheAcc.fresh;
    const hitRatePct = cacheContext > 0 ? Math.round((cacheAcc.read / cacheContext) * 1000) / 10 : 0;
    const cache: CacheEfficiency = {
        read: cacheAcc.read,
        write: cacheAcc.write,
        fresh: cacheAcc.fresh,
        hitRatePct,
        savedUsd: Math.round(cacheAcc.savedUsd * 100) / 100,
        verdict: hitRatePct >= CACHE_HEALTHY_PCT ? 'healthy'
            : hitRatePct >= CACHE_PARTIAL_PCT ? 'partial' : 'investigate',
    };

    const contextLoss: ContextLoss | null = hasContextData ? {
        compactions: ctxAcc.compactions,
        auto: ctxAcc.auto,
        manual: ctxAcc.manual,
        droppedTokens: ctxAcc.dropped,
        costUsd: Math.round(ctxAcc.costUsd * 100) / 100,
        minutes: Math.round((ctxAcc.ms / 60000) * 10) / 10,
        avgPreTokens: ctxAcc.compactions ? Math.round(ctxAcc.preSum / ctxAcc.compactions) : 0,
        sessionsCompacted: ctxAcc.sessionsCompacted,
    } : null;

    const sessionBucketTotal = sizeAcc.s1_5 + sizeAcc.s6_20 + sizeAcc.s21_100 + sizeAcc.s100plus;
    const sessionShape: SessionShape | null = hasSessionShape ? {
        sessions: sessionBucketTotal,
        sizeBuckets: sizeAcc,
        durationBuckets: durAcc,
        shortSessionPct: sessionBucketTotal ? Math.round((sizeAcc.s1_5 / sessionBucketTotal) * 100) : 0,
    } : null;

    const concurrency: ConcurrencyView | null = hasConcurrency ? {
        maxConcurrent: concAcc.peak,
        daysWithOverlap: concAcc.daysWithOverlap,
        activeDays: concAcc.days,
        switches: concAcc.switches,
        switchesUnder5m: concAcc.under5m,
        rapidSwitchPct: concAcc.switches ? Math.round((concAcc.under5m / concAcc.switches) * 100) : 0,
    } : null;

    const gapTotal = gapAcc.lt10s + gapAcc.s10_60 + gapAcc.m1_5 + gapAcc.m5_30 + gapAcc.gt30m;
    const pace: PaceView | null = hasPaceData ? {
        gapBuckets: gapAcc,
        total: gapTotal,
        immediatePct: gapTotal ? Math.round((gapAcc.lt10s / gapTotal) * 100) : 0,
    } : null;

    const modelTasks: ModelTaskRow[] | null = hasModelTaskMix
        ? [...modelMix.entries()]
            .map(([model, mix]) => ({
                model,
                mix,
                prompts: mixTotal(mix),
                tokens: modelTokens[model] || 0,
                cost: Math.round((modelCost[model] || 0) * 100) / 100,
            }))
            .sort((a, b) => b.tokens - a.tokens)
        : null;

    // Per-model average score is not collected (scores are a day total, not
    // split by answering model), so the prompt-quality rule compares the
    // window average against itself and only fires on a genuine shortfall
    // once that data exists. Passing an empty map keeps the rule inert
    // rather than inventing a per-model score.
    const modelSuggestions = modelTasks
        ? buildModelSuggestions(modelTasks, new Map<string, number>(), avg, rows.length)
        : [];

    // VALUE view (ADDENDUM 6): reframe the API list-price cost as leverage vs a
    // seat cost. `apiEquivalentValue` is the same frozen cost, relabeled — it is
    // NOT a bill under a corporate seat license.
    const license = await buildLicenseView({
        orgUuid,
        apiEquivalentValue: Math.round(totals.cost * 100) / 100,
        activeDays: rows.length,
        promptDays: rows.filter((r) => ((r.metrics as ClaudeUsageMetrics)?.prompts?.total || 0) > 0).length,
        prompts: totals.prompts,
        tokens: totals.tokens,
        avgScore: avg,
        reworkPct,
        vaguePct,
    });

    // Good-practice capability usage (ADDENDUM 7) — all from already-collected counts.
    const totalEdits = editsAccepted + editsRejected;
    const editAcceptanceRate = hasEditData && totalEdits > 0
        ? Math.round((editsAccepted / totalEdits) * 100)
        : null;
    const capabilities: CapabilityUsage = {
        skills: struct.skill,
        mcp: struct.mcp,
        // Accurate plan-mode turns when available (collector >= 1.1.0), else the
        // ExitPlanMode proxy for rows from older collectors.
        planMode: hasModeData ? planTurns : (builtin['ExitPlanMode'] || 0),
        acceptEdits: acceptTurns,
        subagents: (builtin['Agent'] || 0) + (builtin['Task'] || 0),
        taskPlanning: builtin['TodoWrite'] || 0,
        webResearch: (builtin['WebSearch'] || 0) + (builtin['WebFetch'] || 0),
        toolCalls: Object.values(builtin).reduce((s, n) => s + n, 0),
        editAcceptanceRate,
        distinctMcpServers: peakDistinctMcpServers,
    };

    // Skill tier (ADDENDUM 9) — a single encouraging number from signals we already
    // have. No new collector data; edit-acceptance contributes only when we have it.
    const skillTier = computeSkillTier({ avgScore: avg, structuredRatioPct, vibeIdx: windowVibeIndex, editAcceptanceRate });

    return {
        rows, // internal only — getMyReport needs it for collectorVersionStatus(); never returned to a caller
        range,
        totals: {
            prompts: totals.prompts,
            sessions: totals.sessions,
            tokens: totals.tokens,
            cost: Math.round(totals.cost * 100) / 100,
            good: totals.good,
            ok: totals.ok,
            poor: totals.poor,
            avgScore: avg,
        },
        daily,
        signals,
        modelSplit,
        pricing: {
            currentVersion: activePricing ? activePricing.version : null,
            versionsUsed: [...versionsUsed.values()].sort((a, b) => a.version - b.version),
        },
        license,
        capabilities,
        promptTypes: promptTypeTotals,
        skillTier,
        hasData: rows.length > 0,
        cache,
        contextLoss,
        sessionShape,
        concurrency,
        pace,
        modelTasks,
        modelSuggestions,
        efficiencyCoverage: { reporting: reportingDays, total: rows.length },
        // Ingredients for a self-view's private `vibe` object — see doc comment above.
        windowVibeIndex,
        structuredRatioPct,
        toolAssistedPct,
        reworkPct,
        vaguePct,
        noContextPct,
        skillInvocations: struct.skill,
        mcpCalls: struct.mcp,
    };
}

export const claudeUsageReportService = {
    /** Admin Data Quality: rows an admin should eyeball (ADDENDUM 5). status='flagged'|'ok'|'all'. */
    async listFlagged(status: 'flagged' | 'ok' | 'all' = 'flagged', limit = 200): Promise<FlaggedRow[]> {
        const where = status === 'all' ? {} : { integrityStatus: status };
        const rows = await ClaudeUsageDaily.findAll({
            where,
            order: [['day', 'DESC']],
            limit,
        });
        const users = await User.findAll({ where: { id: rows.map((r) => r.userId) } });
        const byId = new Map(users.map((u) => [u.id, u]));
        return rows.map((r) => {
            const u = byId.get(r.userId) as any;
            return {
                userId: r.userId,
                login: u?.userId ?? String(r.userId),
                name: u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.userId : String(r.userId),
                day: r.day,
                flags: r.integrityFlags || [],
                avgScore: r.avgScore,
                totalPrompts: r.totalPrompts,
                tokens: totalTokens(r.metrics),
                vibeIndex: r.vibeIndex,
                receivedAt: r.receivedAt ? r.receivedAt.toISOString() : null,
                triggerTier: r.triggerTier ?? null,
            };
        });
    },

    /** Clear a row's flags after admin review (mark ok). */
    async acknowledgeFlag(userId: number, day: string): Promise<boolean> {
        const row = await ClaudeUsageDaily.findOne({ where: { userId, day } });
        if (!row) return false;
        await row.update({ integrityStatus: 'ok', integrityFlags: [] });
        return true;
    },

    async getMyReport(reqUser: any, from?: string, to?: string): Promise<PromptReport> {
        const userId = reqUser?.id as number;

        const [core, consent, token, coaching] = await Promise.all([
            computeUsageCore(userId, from, to),
            collectorAuthService.consentStatus(userId),
            collectorAuthService.tokenStatus(userId),
            ClaudeUsageCoaching.findOne({ where: { userId } }),
        ]);

        const coachingTips = coaching?.tips?.length
            ? coaching.tips
            : heuristicTips({
                noContextPct: core.noContextPct,
                reworkPct: core.reworkPct,
                vaguePct: core.vaguePct,
                structuredRatioPct: core.structuredRatioPct,
                avgScore: core.totals.avgScore,
            });

        return {
            range: core.range,
            consent: {
                consented: consent.consented,
                needsReconsent: consent.needsReconsent,
                currentVersion: consent.currentVersion,
            },
            collector: {
                connected: token.exists,
                lastSeenAt: token.lastSeenAt ? token.lastSeenAt.toISOString() : null,
                lastFour: token.lastFour,
                ...collectorVersionStatus(core.rows),
            },
            totals: core.totals,
            daily: core.daily,
            signals: core.signals,
            vibe: {
                index: core.windowVibeIndex,
                bucket: vibeBucket(core.windowVibeIndex),
                structuredRatioPct: core.structuredRatioPct,
                skillInvocations: core.skillInvocations,
                mcpCalls: core.mcpCalls,
                toolAssistedPct: core.toolAssistedPct,
                reworkPct: core.reworkPct,
                vaguePct: core.vaguePct,
            },
            modelSplit: core.modelSplit,
            coaching: {
                tips: coachingTips,
                source: coaching?.tips?.length ? 'ai' : 'heuristic',
                generatedAt: coaching?.generatedAt ? coaching.generatedAt.toISOString() : null,
            },
            pricing: core.pricing,
            license: core.license,
            capabilities: core.capabilities,
            promptTypes: core.promptTypes,
            skillTier: core.skillTier,
            hasData: core.hasData,
            cache: core.cache,
            contextLoss: core.contextLoss,
            sessionShape: core.sessionShape,
            concurrency: core.concurrency,
            pace: core.pace,
            modelTasks: core.modelTasks,
            modelSuggestions: core.modelSuggestions,
            efficiencyCoverage: core.efficiencyCoverage,
        };
    },

    /**
     * A lead's view of ONE team member (ADDENDUM 24) — click-through from the
     * Team members table. Shares `computeUsageCore` with `getMyReport` but
     * builds its own return literal explicitly (never spreads `core`), so the
     * self-only ingredients (`windowVibeIndex`, `rows`, etc.) can never leak
     * into a lead-facing response even by accident. Caller (the controller)
     * is responsible for checking the target is within the lead's
     * `resolveVisibleUserIds` roster before calling this — this function
     * itself does no access control.
     */
    async getMemberDetailForLead(
        targetUserId: number,
        member: { name: string; login: string },
        from?: string,
        to?: string,
    ): Promise<MemberDetailReport> {
        const core = await computeUsageCore(targetUserId, from, to);
        return {
            member,
            range: core.range,
            totals: core.totals,
            daily: core.daily,
            signals: core.signals,
            modelSplit: core.modelSplit,
            pricing: core.pricing,
            license: core.license,
            capabilities: core.capabilities,
            promptTypes: core.promptTypes,
            skillTier: core.skillTier,
            hasData: core.hasData,
            cache: core.cache,
            contextLoss: core.contextLoss,
            sessionShape: core.sessionShape,
            concurrency: core.concurrency,
            pace: core.pace,
            modelTasks: core.modelTasks,
            modelSuggestions: core.modelSuggestions,
            efficiencyCoverage: core.efficiencyCoverage,
        };
    },

    /**
     * Team view for managers/leads/superuser. Given a set of user ids (resolved by
     * the caller's scope), returns per-member scores + a team trend. Deliberately
     * omits the per-member vibe-coding flag (that nudge is private to each member).
     */
    async getTeamReport(
        userIds: number[],
        from?: string,
        to?: string,
        opts?: { search?: string; page?: number; pageSize?: number },
    ): Promise<TeamReport> {
        const range = defaultRange(from, to);
        if (!userIds.length) {
            return {
                range, teamAvgTrend: [], teamToolAdoptionPct: 0, signals: [], members: [], membersTotal: 0,
                teamModelSplit: [], teamCacheHitPct: 0, teamTokenSinks: [],
                teamModelSuggestions: [], efficiencyCoverage: { reporting: 0, total: 0 },
                lowCacheMembers: { count: 0, shortSessionCount: 0 },
            };
        }

        const [rows, users] = await Promise.all([
            ClaudeUsageDaily.findAll({
                where: { userId: { [Op.in]: userIds }, day: { [Op.between]: [range.from, range.to] } },
                order: [['day', 'ASC']],
            }),
            User.findAll({ where: { id: { [Op.in]: userIds } } }),
        ]);

        // Frozen pricing per row, same approach as getMyReport, so team model cost
        // uses the rates that applied when each row was ingested, not today's.
        const versionMap = await pricingService.getByIds(
            rows.map((r) => r.pricingVersionId).filter((x): x is number => x != null),
        );
        const fallbackRates = configRateSet();

        const nameById = new Map<number, { name: string; login: string }>();
        for (const u of users) {
            nameById.set(u.id, {
                name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.userId,
                login: u.userId,
            });
        }

        // Per-day team average (across members with data that day).
        const byDay = new Map<string, { sum: number; scored: number }>();
        // Per-member accumulators.
        const byMember = new Map<
            number,
            {
                prompts: number; scoreSum: number; scored: number; free: number; toolAssist: number;
                skill: number; mcp: number; trend: Map<string, { sum: number; scored: number }>;
                // ADDENDUM 21 per-member efficiency. `effDays` counts how many of this
                // member's rows carried schema-4 data, so a member on an old collector
                // reports null rather than a zero that reads like a perfect score.
                cacheRead: number; cacheWrite: number; cacheFresh: number;
                ctxDropped: number; sessions: number; sessionPrompts: number;
                peakConcurrent: number; effDays: number;
            }
        >();
        const teamSignals = { no_context: 0, rework: 0, very_short: 0, vague: 0, unclear_referent: 0, short: 0 };
        const teamModelTokens: Record<string, number> = {};
        const teamModelCost: Record<string, number> = {};
        let teamFree = 0;
        let teamTool = 0;
        let teamScored = 0;
        // ADDENDUM 21 team accumulators.
        const teamCache = { read: 0, write: 0, fresh: 0 };
        const teamSinks = { contextLoss: 0, uncachedReads: 0, rework: 0, overModelled: 0 };
        const teamSinkCost = { contextLoss: 0, uncachedReads: 0, rework: 0, overModelled: 0 };
        const teamModelMix = new Map<string, PromptTypeMix>();
        let teamHasModelMix = false;

        for (const row of rows) {
            const m = row.metrics;
            const pm = row.pricingVersionId != null ? versionMap.get(Number(row.pricingVersionId)) : undefined;
            const rates = pm ? pm.rates : fallbackRates;
            for (const [model, t] of Object.entries(m.tokensByModel)) {
                teamModelTokens[model] = (teamModelTokens[model] || 0) + t.input + t.output + t.cache_write + t.cache_read;
                teamModelCost[model] = (teamModelCost[model] || 0) + computeModelCost(t, rateForModel(model, rates));
            }
            const d = byDay.get(row.day) || { sum: 0, scored: 0 };
            d.sum += m.scores.sum;
            d.scored += m.prompts.scored;
            byDay.set(row.day, d);

            const mm =
                byMember.get(row.userId) ||
                {
                    prompts: 0, scoreSum: 0, scored: 0, free: 0, toolAssist: 0, skill: 0, mcp: 0, trend: new Map(),
                    cacheRead: 0, cacheWrite: 0, cacheFresh: 0, ctxDropped: 0,
                    sessions: 0, sessionPrompts: 0, peakConcurrent: 0, effDays: 0,
                };
            mm.prompts += m.prompts.total;
            mm.scoreSum += m.scores.sum;
            mm.scored += m.prompts.scored;
            mm.free += m.structure.freeTextTurns;
            mm.toolAssist += m.structure.toolAssistedTurns;
            mm.skill += m.structure.skillInvocations;
            mm.mcp += m.structure.mcpCalls;
            const t = mm.trend.get(row.day) || { sum: 0, scored: 0 };
            t.sum += m.scores.sum;
            t.scored += m.prompts.scored;
            mm.trend.set(row.day, t);

            // --- ADDENDUM 21 -------------------------------------------------
            const cs = cacheStats(m);
            mm.cacheRead += cs.read;
            mm.cacheWrite += cs.write;
            mm.cacheFresh += cs.fresh;
            teamCache.read += cs.read;
            teamCache.write += cs.write;
            teamCache.fresh += cs.fresh;
            // Uncached context re-reads: fresh input tokens are context Claude had
            // to read at full price because no cache covered it.
            teamSinks.uncachedReads += cs.fresh;
            const dominant = Object.entries(m.tokensByModel)
                .sort((a, b2) => (b2[1].input + b2[1].output) - (a[1].input + a[1].output))[0];
            const inputRate = dominant ? rateForModel(dominant[0], rates).input : rates.fallback.input;
            teamSinkCost.uncachedReads += (cs.fresh / 1e6) * inputRate;

            if (m.context) {
                mm.effDays += 1;
                mm.ctxDropped += m.context.droppedTokens;
                teamSinks.contextLoss += m.context.droppedTokens;
                teamSinkCost.contextLoss += (m.context.droppedTokens / 1e6) * inputRate;
            }
            if (m.sessionShape) {
                const sizes = m.sessionShape.sizeBuckets;
                mm.sessions += sizes.s1_5 + sizes.s6_20 + sizes.s21_100 + sizes.s100plus;
                mm.sessionPrompts += m.prompts.total;
            }
            if (m.concurrency) {
                mm.peakConcurrent = Math.max(mm.peakConcurrent, m.concurrency.maxConcurrent);
            }
            if (m.promptTypesByModel) {
                teamHasModelMix = true;
                for (const [model, pt] of Object.entries(m.promptTypesByModel)) {
                    const acc = teamModelMix.get(model) || emptyMix();
                    acc.debugging += pt.debugging;
                    acc.codeGen += pt.codeGen;
                    acc.refactor += pt.refactor;
                    acc.review += pt.review;
                    acc.explain += pt.explain;
                    acc.other += pt.other;
                    teamModelMix.set(model, acc);
                }
            }
            // Rework: re-prompts that re-cover ground already paid for. Valued at
            // the day's average tokens-per-prompt, which is the best available
            // apportionment — tokens are not attributed to individual prompts.
            if (m.signals.rework > 0 && m.prompts.scored > 0) {
                const perPrompt = totalTokens(m) / m.prompts.scored;
                const reworkTokens = Math.round(perPrompt * m.signals.rework);
                teamSinks.rework += reworkTokens;
                teamSinkCost.rework += (reworkTokens / 1e6) * inputRate;
            }

            byMember.set(row.userId, mm);

            (Object.keys(teamSignals) as (keyof typeof teamSignals)[]).forEach(
                (k) => (teamSignals[k] += (m.signals as any)[k] || 0),
            );
            teamFree += m.structure.freeTextTurns;
            teamTool += m.structure.toolAssistedTurns;
            teamScored += m.prompts.scored;
        }

        const teamAvgTrend = [...byDay.entries()]
            .sort((a, b) => (a[0] < b[0] ? -1 : 1))
            .map(([day, v]) => ({ day, avgScore: v.scored ? Math.round((v.sum / v.scored) * 10) / 10 : null }));

        const teamTurns = teamFree + teamTool;
        const teamToolAdoptionPct = teamTurns ? Math.round((teamTool / teamTurns) * 100) : 0;

        const scoredDen = teamScored || 1;
        const signals: SignalShare[] = (Object.keys(SIGNAL_LABELS) as string[])
            .map((k) => ({
                key: k,
                label: SIGNAL_LABELS[k],
                pct: Math.round(((teamSignals as any)[k] / scoredDen) * 100),
                count: (teamSignals as any)[k] || 0,
            }))
            .filter((s) => s.key !== 'short');

        const teamModelSplit: ModelSplit[] = Object.entries(teamModelTokens)
            .map(([model, tokens]) => ({ model, tokens, cost: Math.round((teamModelCost[model] || 0) * 100) / 100 }))
            .sort((a, b) => b.tokens - a.tokens);

        const members: TeamMemberRow[] = [...byMember.entries()].map(([uid, mm]) => {
            const info = nameById.get(uid) || { name: String(uid), login: String(uid) };
            const avg = mm.scored ? Math.round((mm.scoreSum / mm.scored) * 10) / 10 : 0;
            const memberTurns = mm.free + mm.toolAssist;
            const toolAssistedPct = memberTurns ? Math.round((mm.toolAssist / memberTurns) * 100) : 0;
            const trend = [...mm.trend.entries()]
                .sort((a, b) => (a[0] < b[0] ? -1 : 1))
                .map(([, v]) => (v.scored ? Math.round((v.sum / v.scored) * 10) / 10 : null));
            // Team "focus" is a coaching hint, not the private vibe flag.
            let focus = 'Strong';
            if (toolAssistedPct < 45) focus = 'Adoption';
            else if (avg < 68) focus = 'Context';
            const memberContext = mm.cacheRead + mm.cacheWrite + mm.cacheFresh;
            return {
                userId: uid,
                name: info.name,
                login: info.login,
                prompts: mm.prompts,
                avgScore: avg,
                trend,
                toolAssistedPct,
                focus,
                cacheHitPct: memberContext ? Math.round((mm.cacheRead / memberContext) * 100) : 0,
                // null, not 0 — this member's collector has not reported schema 4,
                // and "no data" must not render as "lost nothing".
                contextLossTokens: mm.effDays > 0 ? mm.ctxDropped : null,
                avgSessionPrompts: mm.sessions > 0 ? Math.round(mm.sessionPrompts / mm.sessions) : null,
                maxConcurrent: mm.peakConcurrent > 0 ? mm.peakConcurrent : null,
            };
        });
        // Sort order deliberately unchanged (avgScore desc). The efficiency columns
        // are context for a conversation, not a ranking to climb.
        members.sort((a, b) => b.avgScore - a.avgScore);

        // Search + pagination (server-side): every OTHER aggregate above (trend,
        // signals, token sinks, model suggestions, adoption %) is computed from
        // the FULL team regardless of this — only the members table itself is
        // filtered and sliced, since that's the one surface meant to be paged
        // through rather than read as a whole-team rollup.
        const search = (opts?.search ?? '').trim().toLowerCase();
        const matched = search
            ? members.filter((m) => m.name.toLowerCase().includes(search) || m.login.toLowerCase().includes(search))
            : members;
        const membersTotal = matched.length;
        const pageSize = Math.min(Math.max(opts?.pageSize ?? 10, 1), 100);
        const page = Math.max(opts?.page ?? 0, 0);
        const pagedMembers = matched.slice(page * pageSize, page * pageSize + pageSize);

        // Whole-team cache-health counts for "Team coaching focus" — computed over
        // the FULL `members` (pre-search, pre-page), never `pagedMembers`.
        const lowCache = members.filter((m) => m.cacheHitPct > 0 && m.cacheHitPct < 80);
        const lowCacheMembers = {
            count: lowCache.length,
            shortSessionCount: lowCache.filter((m) => m.avgSessionPrompts != null && m.avgSessionPrompts < 6).length,
        };

        const teamContext = teamCache.read + teamCache.write + teamCache.fresh;
        const teamCacheHitPct = teamContext ? Math.round((teamCache.read / teamContext) * 1000) / 10 : 0;

        // Over-modelled work: read-only prompts answered by a top-tier model.
        // Counted here rather than inside the loop because it needs the whole
        // range's mix per model to be meaningful.
        for (const [model, mix] of teamModelMix.entries()) {
            const tier = modelTier(model);
            if (!tier || tier.tier < 3) continue;
            const readOnly = mix.explain + mix.review;
            const total = mixTotal(mix);
            if (!total || !readOnly) continue;
            const share = readOnly / total;
            const tokens = Math.round((teamModelTokens[model] || 0) * share);
            teamSinks.overModelled += tokens;
            teamSinkCost.overModelled += (teamModelCost[model] || 0) * share;
        }

        const SINK_LABELS: Record<string, string> = {
            contextLoss: 'Context lost to compaction',
            uncachedReads: 'Uncached context re-reads',
            rework: 'Rework re-prompts',
            overModelled: 'Over-modelled explain/review',
        };
        const sinkTotal = Object.values(teamSinks).reduce((a, b2) => a + b2, 0) || 1;
        const teamTokenSinks = (Object.keys(SINK_LABELS) as Array<keyof typeof teamSinks>)
            .map((k) => ({
                key: k as string,
                label: SINK_LABELS[k],
                tokens: teamSinks[k],
                costUsd: Math.round(teamSinkCost[k] * 100) / 100,
                pct: Math.round((teamSinks[k] / sinkTotal) * 100),
            }))
            .filter((s) => s.tokens > 0)
            .sort((a, b) => b.tokens - a.tokens);

        const teamAvg = teamScored
            ? [...byDay.values()].reduce((s, d) => s + d.sum, 0) / teamScored
            : 0;
        const teamModelTasks: ModelTaskRow[] = teamHasModelMix
            ? [...teamModelMix.entries()].map(([model, mix]) => ({
                model,
                mix,
                prompts: mixTotal(mix),
                tokens: teamModelTokens[model] || 0,
                cost: Math.round((teamModelCost[model] || 0) * 100) / 100,
            }))
            : [];
        const activeDays = byDay.size;
        const teamModelSuggestions = teamHasModelMix
            ? buildModelSuggestions(teamModelTasks, new Map<string, number>(), teamAvg, activeDays)
            : [];

        return {
            range,
            teamAvgTrend,
            teamToolAdoptionPct,
            signals,
            members: pagedMembers,
            membersTotal,
            teamModelSplit,
            teamCacheHitPct,
            teamTokenSinks,
            teamModelSuggestions,
            efficiencyCoverage: {
                reporting: [...byMember.values()].filter((mm) => mm.effDays > 0).length,
                total: byMember.size,
            },
            lowCacheMembers,
        };
    },
};
