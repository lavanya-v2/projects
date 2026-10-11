import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../../config';
import { recordAiUsage } from './aiUsageRecorder';
import { logger } from '../../../common/utils';
import { formatLaneDefinitionsForPrompt, HARDCODED_LANE_CONFIG } from '../../../common/laneDefaults';

interface TicketSummary {
    key: string;
    summary: string;
    issuetype: string;
    status: string;
    assignee: string;
    priority: string;
    updated: string;
    epic: string;
    activity?: string[]; // New field for specific daily activity
}

interface BlockedInfo {
    key: string;
    summary: string;
    status: string;
    assignee: string;
    movedToBlockedToday: boolean;
    blockedSince?: string;
}

interface StaleInfo {
    key: string;
    summary: string;
    assignee: string;
    updated: string;
}

interface PreviousSnapshot {
    date: string;
    work_summary: string;
    overall_health: string;
}

interface AnalysisResult {
    health: string;
    executiveSummary: string;
    keyRisks: string;
    executivePlan: string;
    planForTomorrow: string;
    risks: string;
    notes: string;
    workSummary: string;
    /** Per-ticket activity log (ticket IDs preserved — this is the only field where they are allowed). */
    ticketDetails?: string;
    /** Internal: number of false prod-bug mentions scrubbed by post-processing. NOT stored in DB directly. */
    _scrubCount?: number;
}

/**
 * Build a prompt-safe JSON block from an array of entity records (projects, tickets, days, weeks).
 *
 * Previously prompts embedded `JSON.stringify(arr).substring(0, N)`, which clips the JSON string
 * mid-array and SILENTLY DROPS whole trailing records when the payload exceeds N — corrupting
 * AI-generated counts and risk coverage with no error and no signal.
 *
 * This instead clips each entity's long string fields so EVERY entity is represented. If the
 * clipped payload still exceeds `maxTotal`, it logs a warning (so residual loss is never silent)
 * before falling back to a hard cut.
 */
function buildEntityBlock(
    entities: any[],
    opts: { fieldMax?: number; maxTotal?: number; label: string }
): string {
    const fieldMax = opts.fieldMax ?? 600;
    const maxTotal = opts.maxTotal ?? 40000;
    const compact = (entities || []).map(e => {
        if (e == null || typeof e !== 'object') return e;
        const out: any = Array.isArray(e) ? [] : {};
        for (const [k, v] of Object.entries(e)) {
            out[k] = typeof v === 'string' && v.length > fieldMax ? v.substring(0, fieldMax) + '…' : v;
        }
        return out;
    });
    let json = JSON.stringify(compact);
    if (json.length > maxTotal) {
        console.warn(
            `[PromptTruncation] ${opts.label}: ${json.length} chars after per-field clip exceeds budget ${maxTotal} ` +
            `(${(entities || []).length} entities) — trailing data may be dropped. Lower fieldMax or raise budget.`
        );
        json = json.substring(0, maxTotal);
    }
    return json;
}

// Shared guardrail injected into every risk/blocker-emitting prompt across the system.
// A ticket in "Pending Deployment" (or beyond) is awaiting a release scheduled by release
// management, not the delivery team — so it must never be reported as a risk or blocker.
const DEPLOYMENT_PENDING_EXCLUSION = `
        ### DEPLOYMENT-PENDING EXCLUSION (MANDATORY — applies to ALL risk/blocker output):
        A ticket in "Pending Deployment" (or any awaiting-release / Deployed / Done / Closed status) is controlled by release management, NOT the delivery team. It is delivered from the team's standpoint and its go-live timing is outside the team's control.
        - NEVER list such a ticket as a risk or blocker.
        - NEVER describe any item as "awaiting deployment", "awaiting QA before deployment", "pending release", "pending deployment", or similar language in any risk/blocker field.
        - If input text (a child summary, daily report, or ticket status) flags an item as awaiting deployment/release, treat it as DELIVERED and OMIT it from risks/blockers entirely.`;

// Shared guardrail: a re-opened Sub-bug is QA regression/rework, not a new incident or delivery
// blocker. Mirrors the daily report's rule 7 so every rollup level (weekly/monthly/account/
// program/project) treats re-opened sub-bugs as informational, never as risks.
const REOPENED_SUBBUG_INFORMATIONAL = `
        ### RE-OPENED SUB-BUGS — INFORMATIONAL ONLY (MANDATORY — applies to ALL risk/blocker output):
        A re-opened Sub-bug is QA regression/rework on an in-progress or already-delivered story — it is NOT a new incident and NOT a delivery blocker.
        - NEVER list a re-opened Sub-bug in any risk/blocker field, and never let a re-open drive the risk narrative.
        - Such rework belongs in work/achievement summaries (e.g. "regression addressed during testing"), never in risks. Re-opens do NOT affect health.
        - A re-open that was subsequently moved forward again (back to Testing/UAT/Done) is normal QA cycling — OMIT it from risks entirely.`;

export class AIService {
    private anthropic: Anthropic;

    constructor() {
        this.anthropic = new Anthropic({
            apiKey: config.anthropic.apiKey,
        });
    }

    /**
     * Scrubs false "production bug/defect/issue/fix/incident" labels from DSR AI output.
     * Any such phrase associated with a ticket key NOT in confirmedProdBugKeys is replaced
     * with "test defect" or "QA issue". This is a deterministic safety net on top of the
     * AI prompt instructions.
     */
    /**
     * Public scrub method — applies the same prod-bug hallucination scrubbing to a plain text string.
     * Used for propagation scrubbing: clean DSR text before it feeds into WSR/Account AI.
     * @param text - Input string to scrub
     * @param confirmedProdBugKeys - Keys that are confirmed production bugs and should NOT be scrubbed
     */
    public scrubText(text: string, confirmedProdBugKeys: string[]): string {
        if (!text) return text;
        const PROD_PHRASES = /\bprod(uction)?\s*(bug|defect|issue|fix|incident)\b/gi;
        const TICKET_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
        const keyPositions: { key: string; index: number }[] = [];
        let km: RegExpExecArray | null;
        TICKET_KEY_RE.lastIndex = 0;
        while ((km = TICKET_KEY_RE.exec(text)) !== null) {
            keyPositions.push({ key: km[1], index: km.index });
        }
        return text.replace(PROD_PHRASES, (match, _p1, _p2, offset) => {
            const matchEnd = offset + match.length;
            // Keys before the phrase (original direction)
            const before = keyPositions.filter(kp => kp.index < offset && offset - kp.index <= 120);
            // Keys immediately after the phrase (e.g. "production defect LOSAI-6232:")
            const after  = keyPositions.filter(kp => kp.index >= matchEnd && kp.index - matchEnd <= 60);
            if ([...before, ...after].some(kp => confirmedProdBugKeys.includes(kp.key))) return match;
            return match.toLowerCase().includes('fix') ? 'QA issue' : 'test defect';
        });
    }

    private scrubProdBugHallucinations(result: any, confirmedProdBugKeys: string[]): any {
        let scrubCount = 0;
        const scrubField = (text: string): string => {
            const scrubbed = this.scrubText(text, confirmedProdBugKeys);
            // Count replacements by comparing match counts in original vs scrubbed
            const PROD_PHRASES = /\bprod(uction)?\s*(bug|defect|issue|fix|incident)\b/gi;
            const originalMatches = (text.match(PROD_PHRASES) || []).length;
            const scrubbedMatches = (scrubbed.match(PROD_PHRASES) || []).length;
            scrubCount += originalMatches - scrubbedMatches;
            return scrubbed;
        };

        const fields = ['workSummary', 'executiveSummary', 'keyRisks', 'risks', 'notes', 'executivePlan', 'planForTomorrow'];
        const scrubbed = { ...result };
        for (const f of fields) {
            if (scrubbed[f]) scrubbed[f] = scrubField(scrubbed[f]);
        }
        if (scrubCount > 0) scrubbed._scrubCount = scrubCount;
        return scrubbed;
    }

    /**
     * Scrubs fabricated "blocked ticket(s)" claims from DSR AI output when there is
     * ZERO supporting data for them — no entries in the Blocked/Flagged Tickets list
     * AND no blocked count in the sprint burndown. This mirrors `scrubProdBugHallucinations`:
     * a deterministic safety net on top of prompt instructions, because a prompt-only
     * guardrail has already been observed to fail (the model fabricated "Two blocked
     * tickets require attention..." on a day with an empty blocked-tickets array and
     * blockedV2Tickets = 0 in sprintBurndown — no source data anywhere).
     *
     * Only handles the zero-vs-nonzero case (does it exist at all). Does NOT validate
     * that a stated count matches reality when real blocked tickets DO exist — that's
     * a separate, unconfirmed risk not addressed here.
     */
    private scrubBlockedTicketHallucinations(result: any, hasBlockedTickets: boolean): any {
        if (hasBlockedTickets) return result;

        const BLOCKED_CLAIM_RE = /\bblock(ed|er)?\b/i;
        const fields = ['workSummary', 'executiveSummary', 'keyRisks', 'risks', 'notes', 'executivePlan', 'planForTomorrow'];
        const scrubbed = { ...result };
        let scrubCount = 0;

        for (const f of fields) {
            const text = scrubbed[f];
            if (!text || typeof text !== 'string') continue;
            // Split into sentences so only the fabricated claim is removed, not the whole field.
            const sentences = text.split(/(?<=[.!?])\s+/);
            const kept = sentences.filter((s: string) => {
                if (BLOCKED_CLAIM_RE.test(s)) {
                    scrubCount++;
                    return false;
                }
                return true;
            });
            scrubbed[f] = kept.join(' ').trim();
        }

        if (scrubCount > 0) {
            scrubbed._scrubCount = (scrubbed._scrubCount || 0) + scrubCount;
            console.warn(`[BlockedHallucinationScrub] Removed ${scrubCount} fabricated blocked-ticket claim(s) — no blocked tickets exist in source data.`);
        }
        return scrubbed;
    }

    /**
     * For 'on_the_go' assignment-model projects (sprintBurndown.onTrackStatus === 'not-tracked'),
     * the executiveSummary must never restate sprint-wide SP/ticket totals or percentages — the
     * UI's dedicated progress bar is the single source for those numbers (see the on-the-go
     * prompt block). The prompt instruction alone was observed to not always hold (same failure
     * mode as the blocked-ticket hallucination above): a same-batch pair of reports produced one
     * summary that correctly omitted the numbers and one that restated them verbatim
     * ("44% story points complete (69 of 157 SP)..."). Deterministic scrub, not just prompt text.
     */
    private scrubSprintNumbersFromExecutiveSummary(result: any, isOnTheGoNotTracked: boolean): any {
        if (!isOnTheGoNotTracked) return result;

        const text = result.executiveSummary;
        if (!text || typeof text !== 'string') return result;

        // Matches the shape these leaks actually take: "NN% ... SP)" / "NN% ... tickets)" /
        // a bare "(NN of MM SP)" — specific enough to avoid stripping an unrelated sentence
        // that just happens to contain a number (e.g. "Day 6 of 16").
        const SPRINT_STAT_RE = /\d+%\s*(of\s*)?(the\s*)?(story points?|tickets?|sp\b|complete)|\(\s*\d+\s*(of|\/)\s*\d+\s*(sp|tickets?|story points?)\s*\)/i;

        const sentences = text.split(/(?<=[.!?])\s+/);
        let scrubCount = 0;
        const kept = sentences.filter((s: string) => {
            if (SPRINT_STAT_RE.test(s)) {
                scrubCount++;
                return false;
            }
            return true;
        });

        if (scrubCount === 0) return result;

        const rebuilt = kept.join(' ').trim();
        const scrubbed = {
            ...result,
            // Never leave executiveSummary empty — fall back to a neutral, activity-agnostic
            // line rather than assert "no activity" (which may not be true; workSummary/notes
            // still carry the real activity detail even when this field gets scrubbed).
            executiveSummary: rebuilt || 'See Work Summary for today\'s update.',
        };
        scrubbed._scrubCount = (scrubbed._scrubCount || 0) + scrubCount;
        console.warn(`[SprintNumbersScrub] Removed ${scrubCount} sprint-total restatement(s) from executiveSummary — on-the-go projects show these only in the dedicated progress bar.`);
        return scrubbed;
    }

    /**
     * Strips any invented blocker CAUSE (e.g. "due to technical constraints", "blocked
     * pending external dependency resolution", "requiring architecture decision") from
     * daily/weekly AI output. Unlike the other scrubs, this applies unconditionally,
     * regardless of whether real blocked tickets exist: no field in either pipeline
     * (blockedInfo in the daily prompt, blockedTicketContext in the weekly prompt) ever
     * carries a reason — only key/status/owner/duration. Any causal phrase attached to a
     * blocked-ticket mention is therefore fabricated by construction, not just unlikely.
     * The prompt's own explicit "never invent a cause" rule (present in both prompts)
     * was confirmed live to not hold — same failure mode as the other scrubs in this
     * class, so this is a deterministic net rather than a second prompt-only attempt.
     */
    private scrubBlockerCauseHallucinations(result: any, fields: string[]): any {
        const BLOCK_RE = /\bblock(ed|er|ing)?\b/i;
        const CAUSE_RE = /\b(due to|because(?:\s+of)?|pending\s+\w|requiring|required by|caused by|as a result of|owing to|stemming from|dependency|dependent on|constraint|architectural|external (?:dependency|party|vendor|team)|awaiting\s+\w+\s+resolution|resolution of)\b/i;
        const scrubbed = { ...result };
        let scrubCount = 0;

        for (const f of fields) {
            const text = scrubbed[f];
            if (!text || typeof text !== 'string') continue;
            const sentences = text.split(/(?<=[.!?])\s+/);
            const kept = sentences.filter((s: string) => {
                if (BLOCK_RE.test(s) && CAUSE_RE.test(s)) {
                    scrubCount++;
                    return false;
                }
                return true;
            });
            scrubbed[f] = kept.join(' ').trim();
        }

        if (scrubCount > 0) {
            scrubbed._scrubCount = (scrubbed._scrubCount || 0) + scrubCount;
            console.warn(`[BlockerCauseScrub] Removed ${scrubCount} fabricated blocker-cause claim(s) — no field in this pipeline ever supplies a blocker's reason.`);
        }
        return scrubbed;
    }

    async analyzeBoard(
        boardName: string,
        activeTickets: any[],
        // Tickets moved into QA/UAT/Testing today by the team, with no other logged
        // activity — genuine same-day activity, reported separately from `activeTickets`.
        // This must NEVER be a general "everything idle on the board" list (it was until
        // this was tightened): a ticket with no activity today must not be fed into the
        // narrative at all, regardless of how it's labeled internally.
        queuedTickets: any[],
        blockedTickets: any[],
        previousSnapshot: PreviousSnapshot | null = null,
        staleTickets: any[] = [],
        movedToDone: any[] = [],
        weekendActivity: any[] | undefined = undefined,
        laneDefinitions?: string,
        calculatedHealth: string = 'Green',
        healthRationale: string = 'No deterministic issues detected.',
        managerInsights?: string,
        confirmedProdBugKeys: string[] = [],
        sprintBurndown?: {
            sprintName: string;
            startDate: string;
            endDate: string;
            daysTotal: number;
            daysElapsed: number;
            daysPending: number;
            sprintElapsedPct: number;
            totalV2Tickets: number;
            completedV2Tickets: number;
            storiesPending: number;
            completionPct: number;
            completionPctSP: number;
            offTrackPct: number;
            // 'not-tracked' = on-the-go assignment model, sprint pace deliberately excluded
            // from health scoring; completionPct/completionPctSP are team-wide in that case.
            onTrackStatus: 'on-track' | 'at-risk' | 'critical' | 'not-tracked';
            totalV2SP: number;
            completedV2SP: number;
            inProgressV2SP: number;
            usedSP: boolean;
            totalSprintSP?: number;
            completedSprintSP?: number;
            totalSprintTickets?: number;
            completedSprintTickets?: number;
            v2CurrentWorkloadSP?: number;
            v2CurrentCompletedSP?: number;
            todoSP: number;
            inProgressSP: number;
            inReviewSP: number;
            inQaSP: number;
            inUatSP: number;
            blockedSP: number;
            reopenedSP: number;
        } | null,
        nonQualifiedBugContext: { key: string; issuetype: string; env: string }[] = [],
        reopenedBugKeys: string[] = [],
        spilloverBugKeys: string[] = []
    ): Promise<AnalysisResult> {
        // True only if there is ANY real evidence of a blocked ticket in the data given
        // to the model — used to deterministically scrub fabricated "blocked ticket(s)"
        // claims after the AI responds (see scrubBlockedTicketHallucinations).
        const hasBlockedTickets = blockedTickets.length > 0 || (sprintBurndown?.blockedSP ?? 0) > 0;
        const isOnTheGoNotTracked = sprintBurndown?.onTrackStatus === 'not-tracked';

        const isDummyKey = !config.anthropic.apiKey || config.anthropic.apiKey === 'sk-dummy-key';

        if (isDummyKey) {
            console.warn('Anthropic API Key missing or dummy. Returning mock analysis.');
            return {
                workSummary: "- Completed task A\\n- In Progress task B",
                planForTomorrow: "- Continue with task B\\n- Start task C",
                risks: "None identified.",
                notes: "Board health looks green.",
                health: "Green",
                executiveSummary: "Mock analysis - API key not configured",
                keyRisks: "None",
                executivePlan: "Continue development"
            };
        }

        // Prepare Data for LLM
        const activeTicketSummaries: TicketSummary[] = activeTickets.map(i => ({
            key: i.key,
            summary: i.fields.summary,
            issuetype: i.fields?.issuetype?.name || 'Unknown',
            status: i.fields.status.name,
            assignee: i.fields.assignee ? i.fields.assignee.displayName : 'Unassigned',
            priority: i.fields.priority ? i.fields.priority.name : 'Unknown',
            updated: i.fields.updated,
            epic: i.fields.parent ? (i.fields.parent.fields ? i.fields.parent.fields.summary : i.fields.parent.key) : 'Uncategorized',
            activity: i.dailyActivity || []
        }));

        const queuedTicketSummaries: TicketSummary[] = queuedTickets.slice(0, 50).map(i => ({
            key: i.key,
            summary: i.fields.summary,
            issuetype: i.fields?.issuetype?.name || 'Unknown',
            status: i.fields.status.name,
            assignee: i.fields.assignee ? i.fields.assignee.displayName : 'Unassigned',
            priority: i.fields.priority ? i.fields.priority.name : 'Unknown',
            updated: i.fields.updated,
            epic: i.fields.parent ? (i.fields.parent.fields ? i.fields.parent.fields.summary : i.fields.parent.key) : 'Uncategorized'
        }));

        // No blocker reason text: the previous `reason` field copied a raw Jira
        // comment body (potentially customer personal data) into this prompt.
        const blockedInfo: BlockedInfo[] = blockedTickets.map(b => ({
            key: b.key,
            summary: b.summary,
            status: b.status,
            assignee: b.assignee,
            movedToBlockedToday: b.movedToBlockedToday,
            blockedSince: b.blockedSince
        }));

        const staleInfo: StaleInfo[] = staleTickets.map(s => ({
            key: s.key,
            summary: s.fields.summary,
            assignee: s.fields.assignee ? s.fields.assignee.displayName : 'Unassigned',
            updated: s.fields.updated
        }));

        let previousContext = "No previous report available.";
        if (previousSnapshot) {
            previousContext = `
        Date: ${previousSnapshot.date}
        Summary: ${previousSnapshot.work_summary}
        Health: ${previousSnapshot.overall_health}
        `;
        }

        const prompt = `
        ### GLOBAL OMISSION RULE — MANDATORY:
        Only make claims that are directly supported by data provided in this prompt.
        If you cannot verify a claim from the data above, OMIT it entirely.
        Do NOT use hedged language ("possibly", "may be", "appears to") for unverifiable claims — simply omit them.
        A shorter, accurate report is always better than a longer report with uncertain claims.

        You are a Project Manager Assistant. Analyze the status of the Jira board "${boardName}".
    
        Context from Previous Report (Historical Baseline):
        ${previousContext}

        Current Data:
        - **ACTIVE TICKETS (Work Done Today)**: ${buildEntityBlock(activeTicketSummaries, { label: 'active tickets', fieldMax: 400, maxTotal: 30000 })}
          *These tickets had specific activity Today (Status changed, Comment added, etc.). Use ONLY these for "Work Summary" and "Achievements".*

        - **LINED UP FOR QA/UAT (Activity Today)**: ${buildEntityBlock(queuedTicketSummaries, { label: 'queued tickets', fieldMax: 300, maxTotal: 15000 })}
          *These tickets were moved into QA/UAT/Testing TODAY by the team — this IS today's activity. You may reference them (e.g. "moved to QA for testing"), but do NOT describe them as "done", "resolved", or "delivered".*

        - Blocked/Flagged Tickets: ${JSON.stringify(blockedInfo)}
          *No blocker reason text is available. State only THAT a ticket is blocked, its status and its owner. NEVER invent, infer or speculate about WHY a ticket is blocked — no cause, no dependency, no third party. If you cannot name a blocker cause from data in this prompt, omit the cause entirely.*
          *If this list is EMPTY (${blockedInfo.length === 0 ? 'it IS empty for this report' : 'not applicable here'}), there are ZERO blocked tickets. Do NOT state or imply that any ticket is blocked, "requires attention," or is "impacting workflow" anywhere in ANY output field — that would be entirely fabricated.*
          *This "no invented cause" rule applies EVERYWHERE, not just when describing this list. If a ticket in ACTIVE TICKETS shows a status of "Blocked" (or similar) because it moved there today, you may say it "moved to Blocked today" — that is genuine activity — but you still may NOT invent a reason, technical or otherwise ("architectural decision", "external dependency", "data model constraint", etc.). No field in this prompt ever supplies a blocker's cause. If you don't have one, don't state one — full stop, regardless of which section of the prompt the ticket came from.*
        - Stale Tickets (In Progress > 3 days): ${JSON.stringify(staleInfo)}

        ### NO-ACTIVITY RULE — MANDATORY:
        You have been given ONLY tickets with genuine activity today (ACTIVE TICKETS, LINED UP list) plus current-state Blocked/Stale tickets. You have NOT been given any list of idle, backlog, or otherwise untouched tickets — none exists in this prompt.
        - If ACTIVE TICKETS and LINED UP are both empty, the executiveSummary, workSummary, keyRisks and executivePlan must state plainly that there was no development activity today (referencing Blocked/Stale tickets only if that data is present).
        - NEVER invent, imply, or reach for any other ticket, feature, or backlog/resolved item to fill space on a no-activity day. If you have no data for it in this prompt, it did not happen today as far as this report is concerned.
        - **WEEKEND REFERENCES — FORBIDDEN**: This is a DAILY status report generated on working days. NEVER mention weekends, weekend work, or "weekend activity" anywhere in the Executive Summary, Work Summary, Achievements, Plan, or any other field. Weekend framing is meaningless in a daily report and any such statement would be fabricated.
    
        ${laneDefinitions || formatLaneDefinitionsForPrompt(HARDCODED_LANE_CONFIG)}

        ${sprintBurndown && sprintBurndown.onTrackStatus === 'not-tracked' ? `### Sprint Progress (Team Developers Only) — ON-THE-GO ASSIGNMENT MODEL:
        Sprint: "${sprintBurndown.sprintName}"
        - Timeline: Day ${sprintBurndown.daysElapsed} of ${sprintBurndown.daysTotal} (${sprintBurndown.daysPending} days remaining, ${sprintBurndown.sprintElapsedPct}% elapsed)
        - Team-wide sprint total committed: ${sprintBurndown.totalSprintSP ?? 0} SP (${sprintBurndown.totalSprintTickets ?? 0} tickets), across the WHOLE sprint team, not just this team.
        - Team-wide done so far: ${sprintBurndown.completedSprintSP ?? 0} of ${sprintBurndown.totalSprintSP ?? 0} SP (${sprintBurndown.completedSprintTickets ?? 0} of ${sprintBurndown.totalSprintTickets ?? 0} tickets).
        - This team's contribution to that done total: ${sprintBurndown.v2CurrentCompletedSP ?? sprintBurndown.completedV2SP} SP.
        - This team's current in-progress work (not yet done): ${sprintBurndown.inProgressV2SP ?? 0} SP.

        MANDATORY for this project: this team commits to the sprint's TOTAL scope collectively and picks up tickets on the go — there is no fixed per-person/per-team slice planned from day 1, and this team may be a minority of the whole project team. Sprint pace is DELIBERATELY NOT SCORED for this project (no "on track"/"at risk"/"critical" assessment exists — do not invent one).
        - **Do NOT restate any of these sprint numbers (SP, ticket counts, or percentages) in the executiveSummary field.** The UI already shows a dedicated, accurate team-wide progress bar — the executiveSummary must stay thematic/narrative about actual work and activity that day only, exactly like every other project's executiveSummary (see the "do NOT lead with sprint numbers or counts... synthesize themes, not stats" rule below, which applies here too). If there was no activity today, say so plainly per the NO-ACTIVITY RULE — do not fill that space with sprint totals instead.
        - These numbers MAY appear in workSummary/notes if directly relevant to explaining a specific ticket's activity, but never as a standalone recap of sprint-wide totals.
        - If any of these numbers are used anywhere, NEVER characterize them as a risk, concern, delay, or "behind schedule" — there is no baseline to measure "behind" against, and NEVER use words like "at risk", "behind", "concern", "requires attention", "critical", "off-track" in connection with them.
        - Do NOT compute or imply your own on-track/at-risk assessment from these numbers — none is being made, and none should be implied.
        - Do NOT invent a percentage by dividing two numbers yourself — only use ${sprintBurndown.completionPct}% (tickets) / ${sprintBurndown.completionPctSP}% (story points) exactly as given if a percentage is needed at all, and never pair one against the other's SP/ticket figures as if they matched (they are two separate measures).
        ` : sprintBurndown ? `### Sprint Progress (Team Developers Only):
        Sprint: "${sprintBurndown.sprintName}"
        - Timeline: Day ${sprintBurndown.daysElapsed} of ${sprintBurndown.daysTotal} (${sprintBurndown.daysPending} days remaining, ${sprintBurndown.sprintElapsedPct}% elapsed)
        - Stories: ${sprintBurndown.completedV2Tickets} of ${sprintBurndown.totalV2Tickets} done (${sprintBurndown.storiesPending} pending)
        - Completion: ${sprintBurndown.completionPct}% ticket-weighted (QA counts partial), ${sprintBurndown.completionPctSP}% by story points (${sprintBurndown.completedV2SP}/${sprintBurndown.totalV2SP} SP)
        - Off-track: ${sprintBurndown.offTrackPct}% behind expected pace
        - Assessment: ${sprintBurndown.onTrackStatus.toUpperCase()}${sprintBurndown.onTrackStatus === 'critical' ? ' — severely behind, immediate attention required' : sprintBurndown.onTrackStatus === 'at-risk' ? ' — moderately behind, needs monitoring' : ' — delivery pace is acceptable'}
        ${sprintBurndown.usedSP && sprintBurndown.inProgressV2SP > 0 ? `- Pipeline (pending tickets by stage): ${sprintBurndown.inUatSP > 0 ? `UAT: ${sprintBurndown.inUatSP} SP | ` : ''}${sprintBurndown.inQaSP > 0 ? `QA/Testing: ${sprintBurndown.inQaSP} SP | ` : ''}${sprintBurndown.inReviewSP > 0 ? `In Review: ${sprintBurndown.inReviewSP} SP | ` : ''}${sprintBurndown.inProgressSP > 0 ? `In Progress: ${sprintBurndown.inProgressSP} SP | ` : ''}${sprintBurndown.blockedSP > 0 ? `Blocked: ${sprintBurndown.blockedSP} SP | ` : ''}${sprintBurndown.todoSP > 0 ? `TODO: ${sprintBurndown.todoSP} SP` : ''}`.trim().replace(/\s*\|\s*$/, '') : ''}

        When writing the executiveSummary, do NOT lead with sprint numbers or counts. Instead:
        - Open with what the team accomplished today in functional/business terms (capabilities advanced, features progressed, areas of focus).
        - Derive substance from ticket titles and activity — synthesize themes, not stats.
        - Only if the sprint assessment is "at-risk" or "critical", close with ONE subtle sentence signalling delivery concern, without raw counts or percentages. Example: "Sprint delivery pace warrants monitoring given the volume of work still in early development stages." If the sprint is on-track, omit any sprint metric language entirely.
        - Never start the executiveSummary with "Sprint [name] is..."
        ` : ''}

        ${managerInsights ? `### Manager Insights (Context added by the project manager — incorporate into Executive Summary):
        ${managerInsights}

        IMPORTANT: Use these insights to inform the tone and substance of the executiveSummary. Do NOT copy them verbatim. Blend this human context with the ticket data to produce a more complete executive summary. These insights may mention escalations, team challenges, stakeholder concerns, or delivery risks not visible in Jira.
        ` : ''}

        ### Mandatory Health Assessment (Pre-Calculated — You MUST Respect This):
        - **Calculated Health**: ${calculatedHealth}
        - **Rationale**: ${healthRationale}
        - **Rules**:
          - Use "${calculatedHealth}" as the value for the "health" field.
          - You may NOT downgrade it (e.g. do not change Amber → Green).
          - You MAY escalate to **RED** ONLY if you find explicit evidence of a **P0 production outage** or **critical incident** in the ticket data that was not captured in the rationale above.
          - **Pending Deployment**: Already resolved by the team. Do NOT list as risks.
          - **UAT Ownership Rule**: UAT tickets count as team-complete (development work is done). Do NOT portray UAT as a team delivery failure or team risk. However, apply the following nuances:
            - If a meaningful number of tickets are sitting at UAT and the sprint is near its end date, you MAY note — in one brief sentence — that sprint formal closure depends on customer/PO sign-off on these items. Frame it as a schedule dependency, not a team shortcoming.
            - If a UAT ticket's assignee appears to be a team member (not a customer or PO), flag it as a minor concern since UAT is normally customer responsibility. Keep this proportional — one or two such tickets is only a small note.
            - Never list UAT as incomplete delivery, never include UAT count in "risks" against the team, never use it to justify an Amber or Red health rating.
          - **Sprint Pipeline Rule**: Off-track % measures ticket CLOSURE rate vs elapsed time. Tickets in QA, Testing, or In Review represent late-stage work that is nearly complete — these are POSITIVE pipeline progress signals. Do NOT introduce negative sprint language solely because off-track % is elevated when pending tickets are predominantly in late pipeline stages (QA/In Review). Only treat the sprint as truly risky if many tickets are stuck in early stages (TODO/Blocked) with high elapsed time.

        ### CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):
        1. **TEMPORAL ACCURACY**:
           - **NEVER** mention time durations (e.g., "3 days", "2 weeks", "several days") unless you can PROVE it from the data.
           - For blocked tickets: ONLY mention they are "currently blocked" or "moved to blocked today" (if movedToBlockedToday=true).
           - For stale tickets: The data shows ">3 days in progress" - use ONLY this phrasing. Do NOT say "5 days" or "a week".
           - FORBIDDEN phrases: "for X days/weeks", "since last week", "ongoing for weeks"
           - ALLOWED: "currently blocked", "stale (>3 days)", "moved to blocked today"
           - **NO PERCENTAGES**: DO NOT include any percentage symbols (%) or percentage-based claims (e.g., "14% of WIP") in the executiveSummary. Use only raw counts (e.g., "2 of 14 tickets").

        2. **TICKET STATUS ACCURACY**:
           - Only describe tickets that are EXPLICITLY in the Active Tickets list as having activity today.
           - Do NOT infer progress from ticket status alone - verify from the "activity" field.
           - If a ticket has no activity data, do NOT claim any work was done on it.

        3. **DATA GROUNDING**:
           - Every statement must be traceable to the provided JSON data.
           - If you cannot find evidence in the data, do NOT make the claim.
           - When in doubt, omit the detail rather than guess.

        4. **EXECUTIVE SUMMARY LANGUAGE — MANDATORY**:
           - **NEVER** include Jira ticket IDs (e.g., PROJ-123, LOSAI-456) in the executiveSummary, keyRisks, or executivePlan fields.
           - **NEVER** include verbatim ticket titles in these fields.
           - Write only in terms of functional themes, product areas, module names, or business outcomes (e.g., "correspondence migration", "self-service enhancements", "payment gateway integration").
           - The executiveSummary must be readable by senior executives who have NO access to Jira.
           - Ticket IDs are ONLY permitted in: workSummary and ticketDetails.

        4b. **PRAISE-FREE RULE — MANDATORY**:
           - Do NOT write generic morale statements such as "the team made excellent progress", "the team delivered outstanding results", "strong velocity", "commendable effort", "the team is performing well", or any similar praise language.
           - Every sentence in executiveSummary, keyRisks, and executivePlan must name specific features, module names, capabilities, or factual delivery outcomes.
           - Generic praise adds zero information to an executive and reduces credibility. Replace "Team made excellent progress on authentication" with "Authentication service hardening advanced to QA phase."

        4c. **DRAMA-FREE RULE — MANDATORY (the mirror image of 4b)**:
           - Just as generic praise is forbidden, so is generic alarm. Do NOT escalate a plain fact into dramatic language: no "critical", "severe", "blocking technical constraints requiring architectural decisions", "significant risk", "major concern" unless that severity is directly and explicitly supported by data in this prompt (e.g. the calculated health is genuinely Red, or a real blocked/stale duration is given).
           - A ticket moving to a status (including Blocked) is a plain fact — report it as one. "PHX-1234 moved to Blocked today" is correct; "a severe blocking issue has emerged requiring urgent resolution" is not, unless the data says so.
           - When you don't have a reason for something (a blocker, a delay, a dip in activity), state the fact plainly and stop — do not compensate for the missing explanation with intensified language. A short, flat sentence is always preferable to a dramatic one built on a guess.

        5. **ISSUE TYPE ACCURACY — MANDATORY**:
           - Each ticket has an "issuetype" field (e.g., Story, Bug, Sub-bug, Task, Sub-task, Epic).
           - **NEVER** describe a Story, Task, or Epic as a "bug", "defect", "production bug", "production issue", or "incident" regardless of what the ticket title or activity comments say.
           - **Sub-task** (issuetype = Sub-task or Subtask): A child work item of a parent story. It is NOT a bug and NOT a production issue. NEVER describe a Sub-task as a "bug", "defect", or "production fix" — even if its Priority is Critical or High. Priority does NOT equal production severity. Describe Sub-tasks only as "development sub-task" or "child task".
           - **Sub-bug** (issuetype = Sub-bug): A defect found during testing that caused its parent story to be reopened. It is a QA/test environment defect UNLESS it appears in the confirmed production bug key list below. Do NOT call a Sub-bug a "production bug" unless it is explicitly in that confirmed list.
           - Only tickets with issuetype "Bug", "Sub-bug", or "Defect" may be referred to as bugs or defects.
           - If a Story's activity mentions a failure, error, or issue, describe it as "investigation", "analysis", or "feature work" — NOT as a bug fix or production problem.
           - This rule applies to ALL output fields: workSummary, executiveSummary, keyRisks, risks, notes.

        6. **PRODUCTION BUG — PERMISSION RULE (MANDATORY)**:
           You are ONLY PERMITTED to describe a ticket as a "production bug" or "production defect"
           if its key appears in the confirmed list below. This is a whitelist — anything not on it is not a production bug.

           Confirmed production bugs this report: ${confirmedProdBugKeys.length > 0 ? confirmedProdBugKeys.join(', ') : 'NONE'}

           ${confirmedProdBugKeys.length === 0
               ? `- The confirmed list is NONE. Do NOT mention bugs, defects, or quality incidents anywhere in this report. Omit the topic entirely — do not describe any ticket as a "test defect", "QA issue", or "bug under investigation" either. Simply do not discuss bug/defect topics at all.`
               : `- ONLY the confirmed keys above may be described as "production bugs". All other Bug/Sub-bug tickets are non-production defects — describe them only as "test defect" or "QA issue" and never mention them in the context of production issues.`
           }

           ${nonQualifiedBugContext.length > 0
               ? `The following tickets are Bug/Sub-bug type but are explicitly confirmed to be in TEST/QA environments and are NOT production bugs:
           ${nonQualifiedBugContext.map(t => `  - ${t.key} (${t.issuetype}, Env=${t.env}) → describe only as "test defect" or omit`).join('\n')}
           Do NOT call any of these a "production bug", "critical production fix", or "production incident" under any circumstance.`
               : ''
           }

        7. **RE-OPENED TICKETS (informational only — no health impact)**:
           Re-opened ticket keys: ${reopenedBugKeys.length > 0 ? reopenedBugKeys.join(', ') : 'NONE'}
           ${reopenedBugKeys.length > 0
               ? `- These are Sub-bug tickets filed against currently ongoing parent stories (the parent story is still active on the board).
           - They represent regression or rework on an in-progress story. Mention them in workSummary as "re-opened" or "regression on [parent story name]".
           - Do NOT call them new production bugs. They do NOT affect health and must NOT appear in keyRisks as new incidents.`
               : '- No re-opened sub-bugs this report.'
           }

        8. **SPILLOVER BUGS (flag as Risk)**:
           Spillover bug keys: ${spilloverBugKeys.length > 0 ? spilloverBugKeys.join(', ') : 'NONE'}
           ${spilloverBugKeys.length > 0
               ? `- These production bugs were not resolved in their original sprint and have carried over to the current one.
           - For each spillover bug, include an entry in keyRisks: "Spillover prod bug [KEY]: [brief description from ticket summary] -- unresolved from previous sprint."
           - Use the ticket summary from the Active Tickets list for the description.`
               : '- No spillover bugs this report.'
           }

        ### Report Generation Instructions:
        1. **Functional Summaries (Theme-based)**:
           - **STRICTLY** focus on the "ACTIVE TICKETS" list.
           - If a ticket is in "ACTIVE TICKETS", describe *why* it is active (e.g., "Moved to QA", "PR Updated", "Comment added re: requirements").
           - **DO NOT** hallucinate progress for any ticket not present in "ACTIVE TICKETS" or "LINED UP FOR QA/UAT". If a ticket is in UAT waiting for signs but not in either list, do not mention it.

        2. **Executive Layer**:
           - "Work Done Today": Summary of functional progress based on ACTIVE TICKETS.
           - "Key Risks": 
             - **STRICTLY BLOCKERS AND DELAYS ONLY**.
             - **ABSOLUTELY NO** "Watch items", "High Priority started", or "Monitoring needed" items. 
             - If a ticket is NOT blocked and NOT stale, it is NOT a risk.
             - **CRITICAL**: Do NOT include tickets in "Pending Deployment" as risks.
             - **UAT RISK RULE**: If a ticket's status CONTAINS 'UAT' and the UAT assignee is NOT a team member, EXCLUDE it from risks and work summaries — it is customer/PO-owned. If the UAT assignee IS a team member, treat it as active team work and include in risks/summaries normally. For tickets in any non-UAT status, treat as standard active work regardless of assignee.

        3. **Plan for Tomorrow (Refined)**:
           - **Tone**: Use suggestive language (e.g., "suggested to continue", "likely to be picked up"). Avoid assertive "will do" or "is scheduled".
           - **Exclusions**: Do NOT include tickets in **PO Review** or **UAT** (unless UAT is by a team member) in the "Plan for Tomorrow".
           - **Heuristics**:
             - *In Progress*: "Suggest continuing development on Feature X."
             - *Moved to QA*: "Ready for testing turnover."
             - *Dev Complete*: "Suggest code review."

        4. **JSON ONLY**: Do not output markdown code blocks if possible, just the raw JSON string.

        Return ONLY a valid JSON object.

        JSON Structure (Order is Critical):
        {
            "health": "Must match the Mandatory Health Assessment (Green/Amber/Red). Only escalate to Red for P0 outages not captured above.",
           "executiveSummary": "2-3 sentences for a CXO/VP with no Jira access. Name specific features, modules, or capabilities worked on today. NEVER start with generic praise. NEVER include ticket IDs. Focus on business outcomes and functional progress areas.",
           "keyRisks": "Top 1-2 critical risks. Name the module/feature at risk. No ticket IDs. No praise. Be direct.",
           "executivePlan": "One concise sentence on primary goal for tomorrow. Name the feature or module. No ticket IDs.",
           "planForTomorrow": "Suggested next steps (Brief). Ticket IDs allowed here.",
           "risks": "Details of blocked items/Stale tickets. Ticket IDs allowed here. You MAY use percentages.",
           "notes": "Brief observations on board health/velocity.",
           "workSummary": "Concise bulleted summary grouped by Theme. Ticket IDs allowed here.",
           "ticketDetails": "Per-ticket activity log for TODAY's active tickets ONLY. This is the ONLY other field where Jira ticket IDs are permitted. One line per active ticket: '- KEY: [issuetype] brief description of what was done today and current status.' Max 15 words per line. Omit tickets with no activity today. This section is for team members, not executives."
        }
        `;

        try {
            const response = await this.anthropic.messages.create({
                model: "claude-sonnet-4-5-20250929",
                max_tokens: 8192,
                temperature: 0.2,
                system: prompt,
                messages: [
                    { role: "user", content: `Analyze these tickets. Active: ${activeTicketSummaries.length}, Queued: ${queuedTicketSummaries.length}. Return specific JSON.` }
                ]
            });

            recordAiUsage('daily-dsr', response.model, response.usage);

            let content: string;
            const firstContentBlock = response.content[0];
            if (firstContentBlock && firstContentBlock.type === 'text') {
                content = firstContentBlock.text;
            } else {
                console.error("Anthropic API did not return a text content block as expected:", firstContentBlock);
                throw new Error("Unexpected content type from Anthropic API. Expected 'text' block.");
            }

            // Robust JSON Extraction & Repair
            let jsonStr = content;
            const jsonMatch = content.match(/\{[\s\S]*\}/);

            if (jsonMatch) {
                jsonStr = jsonMatch[0];
            } else {
                const start = content.indexOf('{');
                if (start !== -1) {
                    jsonStr = content.substring(start);
                }
            }

            try {
                return this.scrubBlockerCauseHallucinations(
                    this.scrubSprintNumbersFromExecutiveSummary(
                        this.scrubBlockedTicketHallucinations(
                            this.scrubProdBugHallucinations(JSON.parse(jsonStr), confirmedProdBugKeys),
                            hasBlockedTickets
                        ),
                        isOnTheGoNotTracked
                    ),
                    ['workSummary', 'executiveSummary', 'keyRisks', 'risks', 'notes', 'executivePlan', 'planForTomorrow']
                );
            } catch (e) {
                console.warn("JSON Parse Failed. Attempting repair...");

                // Simple Repair Heuristic for Truncated JSON
                if (jsonStr.trim().lastIndexOf('}') !== jsonStr.trim().length - 1) {
                    const repairs = [
                        jsonStr + '"}',
                        jsonStr + '"]}',
                        jsonStr + '}',
                        jsonStr + '"}'
                    ];

                    for (const fixed of repairs) {
                        try {
                            const parsed = JSON.parse(fixed);
                            if (!parsed.health) parsed.health = "Unknown";
                            if (!parsed.executiveSummary) parsed.executiveSummary = "Analysis Truncated";
                            return this.scrubBlockerCauseHallucinations(
                                this.scrubSprintNumbersFromExecutiveSummary(
                                    this.scrubBlockedTicketHallucinations(
                                        this.scrubProdBugHallucinations(parsed, confirmedProdBugKeys),
                                        hasBlockedTickets
                                    ),
                                    isOnTheGoNotTracked
                                ),
                                ['workSummary', 'executiveSummary', 'keyRisks', 'risks', 'notes', 'executivePlan', 'planForTomorrow']
                            );
                        } catch (err) { continue; }
                    }
                }

                // Deliberately NOT writing the raw response to disk: it restates ticket
                // titles and other board content, and error_analysis.log had no rotation
                // or access controls. Length alone is enough to diagnose truncation.
                logger.error(`AI response unparseable after repair attempts (length=${content.length} chars)`, undefined, 'AiService');

                return {
                    workSummary: "⚠️ Error Generating Summary. AI Response was not valid JSON (Truncated).",
                    planForTomorrow: "",
                    risks: "",
                    notes: "AI response could not be parsed. Retry the analysis.",
                    health: "Unknown",
                    executiveSummary: "Error in analysis",
                    keyRisks: "Unknown",
                    executivePlan: "Retry analysis"
                };
            }

        } catch (error) {
            console.error("LLM Analysis Error:", error);
            throw error;
        }
    }

    /**
     * Strips fabricated "blocked for N days (since DATE)" claims from the weekly summary --
     * the exact template shape the weekly prompt's own "Blocked Ticket Duration" rule
     * produces (see generateWeeklySummary) -- for any ticket not actually present in the
     * fact-checked `blockedTicketContext` passed to that prompt. Deterministic safety net,
     * same pattern as scrubBlockedTicketHallucinations/scrubSprintNumbersFromExecutiveSummary:
     * the prompt instruction alone ("use ONLY the durations from the verified section... if
     * a ticket is not in the verified list, do NOT mention its blocked duration at all") was
     * observed to not reliably hold -- a confirmed case produced this exact duration format
     * for two tickets while the verified list was empty, sourced from unverified daily
     * free-text risk narration instead.
     */
    private scrubUnverifiedBlockedDurations(result: any, verifiedKeys: Set<string>): any {
        const fields = ['executive_summary', 'risks', 'work_summary', 'achievements', 'additional_notes', 'trendAnalysis'];
        const TICKET_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;
        const DURATION_CLAIM_RE = /blocked\s+for\s+\d+\s+days?\s*\(since\s+[^)]+\)/i;
        const scrubbed = { ...result };
        let scrubCount = 0;

        for (const f of fields) {
            const text = scrubbed[f];
            if (!text || typeof text !== 'string') continue;
            const sentences = text.split(/(?<=[.!?])\s+/);
            const kept = sentences.filter((s: string) => {
                if (!DURATION_CLAIM_RE.test(s)) return true;
                const keyMatch = s.match(TICKET_KEY_RE);
                const key = keyMatch ? keyMatch[1] : null;
                if (key && verifiedKeys.has(key)) return true; // genuinely verified -- keep
                scrubCount++;
                return false;
            });
            scrubbed[f] = kept.join(' ').trim();
        }

        if (scrubCount > 0) {
            scrubbed._scrubCount = (scrubbed._scrubCount || 0) + scrubCount;
            console.warn(`[WeeklyBlockedDurationScrub] Removed ${scrubCount} unverified blocked-duration claim(s) -- not present in the fact-checked list.`);
        }
        return scrubbed;
    }

    async generateWeeklySummary(
        dailySummaries: any[],
        previousWeeksContext: any[] = [], // New: Historical Context
        trendContext?: any, // NEW: Data-Driven Trends
        laneDefinitions?: string, // Lane config for this project
        blockedTicketContext?: any[], // FACT-CHECKED: Blocked tickets with actual durations
        managerInsights?: string, // Collated manager insights from daily reports
        confirmedProdBugKeys: string[] = [], // Verified prod bug keys from daily snapshots
        endOfWeekTicketStatuses?: string // Authoritative latest per-ticket status as of week end (last daily snapshot's ticketDetails)
    ): Promise<any> {
        // Determine if this project has a production/deployed lane so we can
        // guard against incorrect production-throughput observations.
        const laneDefStr = laneDefinitions || '';
        const hasProductionLane = /production|deployed.?to.?prod|live|release/i.test(laneDefStr);
        const productionLaneGuard = hasProductionLane
            ? ''
            : `
        ### IMPORTANT — No Production Deployment Lane:
        The Jira lane configuration for this project does NOT include a "Production", "Deployed", or "Released" lane.
        Production deployments for this team are handled outside of Jira and are NOT in the team's control.
        - Do NOT comment on "zero production throughput" or "no production deployments".
        - The "throughput" metric in trendContext refers ONLY to tickets moved to the Done/Closed status within the sprint — it does NOT represent production releases.
        - Do NOT infer any conclusions about production deployment activity from this data.
        `;

        const prompt = `
        ### GLOBAL OMISSION RULE — MANDATORY:
        Only make claims that are directly supported by data provided in this prompt.
        If you cannot verify a claim from the data above, OMIT it entirely.
        Do NOT use hedged language ("possibly", "may be", "appears to") for unverifiable claims — simply omit them.
        A shorter, accurate report is always better than a longer report with uncertain claims.

        You are a Project Manager Assistant. Generate a **Weekly Executive Summary** based on the following daily reports.

        ### Lane Configuration (Jira workflow for this project):
        ${laneDefStr || 'Not provided.'}
        ${productionLaneGuard}

        ### trendContext (Quantitative Data):
        Note: "throughput" = number of tickets moved to Done/Closed this week. It does NOT represent production releases.
        ${JSON.stringify(trendContext || {})}

        ### Historical Context (Last 2 Weeks):
        ${JSON.stringify(previousWeeksContext)}

        ### Current Week Daily Reports (Mon-Fri/Sat):
        ${buildEntityBlock(dailySummaries, { label: 'daily summaries', fieldMax: 800, maxTotal: 30000 })}

        ### Blocked Tickets with VERIFIED Durations:
        **CRITICAL**: The following blocked ticket data has been fact-checked against the actual daily report history.
        Use ONLY these exact durations when mentioning blocked tickets. DO NOT estimate, infer, or extrapolate durations.
        ${blockedTicketContext && blockedTicketContext.length > 0
                ? JSON.stringify(blockedTicketContext, null, 2)
                : 'No currently blocked tickets.'}

        ${managerInsights ? `### Manager Insights (Human Context — Escalations, Customer Concerns, Team Observations):
        The following insights were captured by team leads and managers from the ground. This information is NOT in Jira — it comes from verbal escalations, customer conversations, and on-the-ground observations. You MUST incorporate the key themes from these insights into the executive_summary.
        "${managerInsights}"
        ` : ''}

        ### End-of-Week Ticket Statuses (AUTHORITATIVE — latest status of each ticket as of week end):
        ${endOfWeekTicketStatuses || 'Not provided.'}

        ### Instructions:
        1.  **Blocked Ticket Duration - MANDATORY RULE**:
            -   When mentioning blocked tickets in risks or summary, use ONLY the durations from "Blocked Tickets with VERIFIED Durations" section above.
            -   Format: "Ticket X blocked for [formattedDuration] (since [blockedSince])"
            -   Example: "LS-1844 blocked for 2 days (since 2026-02-20)"
            -   **NEVER** say "three weeks", "several weeks", or any duration NOT explicitly provided in the verified data.
            -   If a ticket is not in the verified list, do NOT mention its blocked duration at all.
            -   **If the "Blocked Tickets with VERIFIED Durations" section above says "No currently blocked tickets", there is NOTHING to report as blocked this week — do not produce a "blocked for X days (since Y)" claim for ANY ticket, regardless of what a daily report's free-text risks/summary field says.** Those daily free-text fields are unverified narrative context, not fact-checked data — never re-cast them into this duration template.
            -   **NEVER invent a blocker's CAUSE**, verified duration or not — no "technical constraint", "architectural decision", "external dependency", or similar. Nothing in this prompt supplies a reason a ticket is blocked. If a daily summary mentions a ticket moved to Blocked, you may note that fact, but never repeat or embellish a cause it wasn't given either — omit the cause entirely.

        1b. **DEPLOYMENT-PENDING EXCLUSION (MANDATORY)**:
            -   A ticket in "Pending Deployment" (or any awaiting-release / Done / Closed status) is controlled by release management, NOT the team. It is delivered from the team's standpoint.
            -   Do NOT list such a ticket as a risk or blocker, and do NOT describe any ticket as "awaiting deployment", "awaiting QA before deployment", "pending release", or similar language in the "risks" field.
            -   Use the "End-of-Week Ticket Statuses" section above as the source of truth: if an earlier daily report flagged a ticket as awaiting QA/deployment but its end-of-week status is Pending Deployment (or Done/Closed), treat it as DELIVERED and OMIT it from risks entirely.

        1c. **RE-OPENED SUB-BUGS — INFORMATIONAL ONLY (MANDATORY)**:
            -   Mirrors the daily-report rule. A re-opened Sub-bug is QA regression/rework on an in-progress or already-delivered story — it is NOT a new incident and NOT a delivery blocker.
            -   Do NOT list a re-opened Sub-bug in the "risks" field, and do NOT let a re-open drive the risk narrative. Such rework belongs in work_summary/achievements (e.g. "regression addressed during testing"), never in risks. Re-opens do NOT affect health.
            -   A re-open that was subsequently moved forward within the week (e.g. back to Testing/UAT/Done) is normal QA cycling — OMIT it from risks entirely.

        2.  **Trend Analysis**:
            -   Use "trendContext" to compare this week's performance (Avg Active, Max Blocked) with previous weeks.
            -   mention specific numbers if relevant (e.g. "Velocity increased...", "Blockers reduced from X to Y").
            -   Is velocity improving? Are bugs increasing?

        3.  **Product Quality / Bug Logic (ANTI-HALLUCINATION)**:
            -   Confirmed production bugs for this week (verified via Jira Environment=Production): ${confirmedProdBugKeys.length > 0 ? confirmedProdBugKeys.join(', ') : 'NONE'}.
            -   ONLY if the confirmed list is non-empty, you MAY flag Status as RED/AMBER and mention them explicitly in Risks.
            -   If the list is NONE: do NOT escalate health based on bug-related language in daily summaries. The daily text may contain phrases like "test defect", "QA issue", or "sub-bug" — these are NOT production incidents and must NOT affect health scoring.
            -   **CRITICAL**: Do NOT re-classify a "test defect" or "QA issue" from daily summaries as a "production bug". The confirmed key list above is the authoritative source — not the text of the daily reports.
            -   Do NOT infer production incidents from ticket Priority (Critical/High priority does NOT equal production severity).

        4.  **Executive Focus**: "Status" should reflect the overall week's health (Green/Amber/Red).
        5.  **Validation**: If the daily data is sparse or contains only "No report generated" or "No data available" entries, set "status" to "Green" and note data unavailability in "additional_notes". Do NOT set status to Red or Amber purely because of missing/sparse data — absence of data is NOT a project health indicator.
        6.  **Deployment Observations**: Only comment on production deployments or release throughput if the Lane Configuration above shows a production/release lane. Otherwise, omit any such observations entirely.

        7.  **PRAISE-FREE RULE**: Do NOT write generic morale statements ("the team made excellent progress", "outstanding delivery", "commendable effort"). Name specific features, module names, or capabilities in every sentence of executive_summary and achievements. Generic praise reduces credibility with executives.

        7b. **DRAMA-FREE RULE (the mirror image of 7)**: Just as generic praise is forbidden, so is generic alarm. Do NOT escalate a plain fact into dramatic language — no "critical", "severe", "blocking technical constraints requiring architectural decisions", "significant risk" — unless that severity is directly and explicitly supported by data in this prompt. A ticket moving to Blocked, or a quiet week's throughput number, is a plain fact: state it plainly. When you don't have a reason for something, say so and stop — don't compensate for the missing explanation with intensified language.

        8.  **TICKET ID BAN**: Do NOT include Jira ticket IDs (e.g., LP-123) in executive_summary or achievements. Use feature/module/capability names instead.

        ### JSON Output Format:
        Return ONLY a JSON object:
        {
           "executive_summary": "Two paragraphs for senior executives. First: key features/capabilities progressed this week (name specific modules/features). Second: critical risks/blockers. No ticket IDs. No generic praise. No Jira references.",
           "work_summary": "High-level summary of what was delivered this week (approx 3-4 bullets). Feature/module names preferred.",
           "achievements": "Specific milestones — name the feature or module (e.g., 'Payment gateway integration completed', 'Mobile onboarding flow moved to QA'). No ticket IDs. No praise language.",
           "risks": "Major ongoing risks or blockers. Ticket IDs are acceptable here for traceability. Exclude tickets in Pending Deployment / awaiting release per the Deployment-Pending Exclusion rule.",
           "status": "Green, Amber, or Red",
           "trendAnalysis": "Data-driven paragraph connecting quantitative trends with qualitative progress.",
           "additional_notes": "Any other strategic observations in a bulleted list format."
        }
        `;

        try {
            const response = await this.anthropic.messages.create({
                model: "claude-sonnet-4-5-20250929",
                max_tokens: 4096,
                temperature: 0.2,
                system: prompt,
                messages: [
                    { role: "user", content: "Generate weekly summary." }
                ]
            });

            recordAiUsage('weekly-summary', response.model, response.usage);

            const content = (response.content[0] as any).text;
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : content;

            const verifiedKeys = new Set((blockedTicketContext || []).map((t: any) => t.key));
            return this.scrubBlockerCauseHallucinations(
                this.scrubUnverifiedBlockedDurations(JSON.parse(jsonStr), verifiedKeys),
                ['executive_summary', 'risks', 'work_summary', 'achievements', 'additional_notes', 'trendAnalysis']
            );

        } catch (error) {
            console.error("Weekly AI Analysis Failed:", error);
            return {
                work_summary: "Error generating summary.",
                achievements: "",
                risks: "",
                status: "Unknown",
                trendAnalysis: "Unknown",
                additional_notes: "AI Service Error"
            };
        }
    }
    async generateAccountSummary(
        projectSummaries: any[],
        context: { accountId?: number; redThresholdPercentage?: number } = {},
        managerInsights?: string
    ): Promise<any> {
        // 1. Deterministic Health Calculation
        // Filter out Unknown/no-data projects from calculation — absence of data is not a health indicator
        const activeProjects = projectSummaries.filter(p => p.status !== 'Unknown' && p.status !== null && p.status !== undefined);
        const totalProjects = activeProjects.length;

        const redWithBugs = activeProjects.filter(p => (p.status === 'Red' && p.hasHighSeverityBugs)).length;
        const redProjects = activeProjects.filter(p => p.status === 'Red');
        const amberProjects = activeProjects.filter(p => p.status === 'Amber');

        const redCount = redProjects.length;
        const amberCount = amberProjects.length;
        const greenCount = activeProjects.filter(p => p.status === 'Green').length;
        const redPercentage = totalProjects > 0 ? (redCount / totalProjects) * 100 : 0;

        // Authoritative project-count context for the narrative. The AI must use these exact
        // numbers rather than counting the (possibly truncated) project list below, otherwise
        // large accounts get undercounted (e.g. "8 active projects" when 17 were reported).
        const totalReported = projectSummaries.length;
        const unknownCount = totalReported - totalProjects;

        // Keep only the fields the narrative needs (managerInsights is collated separately).
        // buildEntityBlock then clips each field so EVERY project is represented — previously the
        // whole JSON array was clipped at 15k chars, silently dropping projects on large accounts.
        const minimalSummaries = projectSummaries.map(p => ({
            projectName: p.projectName,
            status: p.status,
            summary: p.summary,
            risks: p.risks,
            achievements: p.achievements
        }));

        const threshold = context.redThresholdPercentage || 30; // Default 30%

        let calculatedHealth = 'Green';
        let healthRationale = '';

        if (redPercentage >= threshold) {
            calculatedHealth = 'Red';
            healthRationale = `CRITICAL: ${redCount}/${totalProjects} projects are RED (${redPercentage.toFixed(1)}%). Exceeds threshold of ${threshold}%.`;
        } else if (redCount > 0 || amberCount > 0) {
            calculatedHealth = 'Amber'; // Or Red if strict? User said 30% for Red account.
            // But if < 30% Red, but > 0 Red, typical status is Amber with Red Risks.
            // However, if we have High Severity Production Bugs, we might want to flag harder.
            healthRationale = `WARNING: ${redCount} Red projects and ${amberCount} Amber projects present. Below ${threshold}% threshold for Account Red.`;
        } else {
            calculatedHealth = 'Green';
            healthRationale = 'All projects are healthy.';
        }

        const prompt = `
        ### GLOBAL OMISSION RULE — MANDATORY:
        Only make claims that are directly supported by data provided in this prompt.
        If you cannot verify a claim from the data above, OMIT it entirely.
        Do NOT use hedged language ("possibly", "may be", "appears to") for unverifiable claims — simply omit them.
        A shorter, accurate report is always better than a longer report with uncertain claims.

        You are a Program Manager Assistant. Generate a **Consolidated Account-Level Weekly Executive Summary** based on the following project reports.
        
        ### Account Composition (AUTHORITATIVE — use these EXACT numbers; never recount from the project list below):
        - Total projects reported this week: ${totalReported}
        - Green: ${greenCount} | Amber: ${amberCount} | Red: ${redCount}${unknownCount > 0 ? ` | No-data: ${unknownCount}` : ''}
        - When the summary states how many projects the account spans or delivered across, you MUST use ${totalReported}. Do NOT infer the count by counting the entries in the project list below — that list may be condensed.

        ### Mandatory Health Assessment:
        - **Calculated Account Health**: ${calculatedHealth}
        - **Rationale**: ${healthRationale}
        - **Red Threshold**: ${threshold}%
        - You MUST respect this calculated health. Do NOT override it based on sentiment unless there is a catastrophic error in data.

        ### Project Summaries:
        ${buildEntityBlock(minimalSummaries, { label: 'account weekly project summaries', maxTotal: 40000 })}

        ${managerInsights ? `### Manager Insights (Account-Level Human Context):
        The following insights were captured by project leads and managers across projects in this account. These include escalations, customer concerns, and observations NOT available in Jira data. Incorporate the key themes into the "summary" field.
        "${managerInsights}"
        ` : ''}

        ### Instructions:
        1.  **TEMPORAL ACCURACY - CRITICAL ANTI-HALLUCINATION RULE**:
            -   **NEVER** mention durations (e.g., "three weeks", "two days", "several weeks") unless EXPLICITLY stated in the project summaries above.
            -   If a project risk mentions "blocked for X days/weeks", use that EXACT wording. DO NOT extrapolate.
            -   Examples of FORBIDDEN phrases: "blocked for three consecutive weeks", "ongoing for several weeks", "persisting for months"
            -   ONLY allowed: Exact quotes from project summaries (e.g., "blocked since Thursday", "blocked for 2 days")
            -   When in doubt about duration, use general terms: "currently blocked", "ongoing blocker", "unresolved"

        2.  **PRODUCTION BUG ACCURACY**:
            -   Do NOT introduce or amplify "production bug" language that is not explicitly present in the project summaries provided.
            -   If a project's weekly summary describes an issue as "test defect" or "QA issue", do NOT re-label it as "production bug" or "production incident" in this account summary.
            -   Only use the term "production bug" or "production incident" if a project weekly summary explicitly uses that term.

        3.  **Executive Summary**:
            -   Synthesize a high-level narrative.
            -   **PROJECT COUNT**: Any project count you mention MUST match the "Account Composition" numbers above (total projects reported = ${totalReported}). Never derive the count by counting the project list.
            -   **CONSTRAINT**: Do NOT mention specific Jira ticket keys (e.g., PROJ-123) or low-level technical minutiae.
            -   **CRITICAL**: If a project report mentions "No daily status reports were generated" or "No report generated for this week", or has status "Unknown", do NOT describe it as a failure or use alarmist language like "catastrophic reporting failure" or "blackout". Simply IGNORE it from the narrative or list it as "Data Unavailable". These projects do NOT contribute to the account health.
            -   Focus on business value, delivery milestones, and overall stability.

        4.  **Risk Management**:
            -   **CRITICAL RULE**: If ANY project is marked **RED** (not Unknown/no-data), it MUST be explicitly mentioned here.
            -   Highlight the specific projects causing concern and why.
            -   **DO NOT** list any project in "red_projects" if its status is "Unknown" or if it has no data. Only genuine RED-status projects belong there.
            -   When copying risk descriptions from project summaries, preserve the EXACT temporal language used.

        5.  **Recommendations**:
            -   Provide a "Strategic Recommendations" section.
            -   Suggest specific next steps for Senior Management to help resolve the identified risks (e.g., "Escalate resource request for Project X", "Review QA process for Project Y").

        ${DEPLOYMENT_PENDING_EXCLUSION}
        ${REOPENED_SUBBUG_INFORMATIONAL}

        Return ONLY a JSON object:
        {
           "summary": "High-level executive narrative (3-4 sentences). NO TICKET KEYS.",
           "key_accomplishments": ["List of major delivery milestones across the account. Derived from project achievements. ${projectSummaries.length > 1 ? "Format: '[Project Name]: Accomplishment'. If account-wide, omit brackets." : "Do NOT prefix with project name."} ABSOLUTELY NO TICKET KEYS (e.g. ABC-123)."],
           "risks": {
               "summary": "3-4 line high level summary of the risks.",
               "items": ["List of top critical risks as strings. ${projectSummaries.length > 1 ? "Format: '[Project Name]: Risk description'. If general account risk, omit brackets." : "Do NOT prefix with project name."} ABSOLUTELY NO TICKET KEYS."]
           },
           "action_items": ["List of recommended action items based on the risks and criticality. ${projectSummaries.length > 1 ? "Format: '[Project Name]: Action item'. If account-wide, omit brackets." : "Do NOT prefix with project name."}"],
           "red_projects": ["Project A", "Project B"],
           "recommendations": "Strategic next steps for management.",
           "health": "${calculatedHealth}",
           "notes": "Additional observations."
        }
        `;

        try {
            const response = await this.anthropic.messages.create({
                model: "claude-sonnet-4-5-20250929",
                max_tokens: 4096,
                temperature: 0.2,
                system: prompt,
                messages: [
                    { role: "user", content: "Generate account summary." }
                ]
            });

            recordAiUsage('account-weekly-summary', response.model, response.usage);

            const content = (response.content[0] as any).text;
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : content;

            return JSON.parse(jsonStr);

        } catch (error) {
            console.error("Account AI Analysis Failed:", error);
            return {
                summary: "Error generating account summary.",
                risks: "",
                health: "Unknown",
                recommendations: "Error"
            };
        }
    }

    /**
     * Generate a Program-level Daily executive summary by aggregating each project's
     * DailyBoardSnapshot for one date. Mirrors generateAccountSummary's structure
     * (and its return shape so the deterministic health override + frontend reuse).
     */
    async generateDailyProgramSummary(
        projectDailyInputs: any[],
        context: { programId?: number; programName?: string; redThresholdPercentage?: number; date?: string } = {},
        managerInsights?: string
    ): Promise<any> {
        const activeProjects = projectDailyInputs.filter(p => p.status !== 'Unknown' && p.status !== null && p.status !== undefined);
        const totalProjects = activeProjects.length;

        const redCount = activeProjects.filter(p => p.status === 'Red').length;
        const amberCount = activeProjects.filter(p => p.status === 'Amber').length;
        const redPercentage = totalProjects > 0 ? (redCount / totalProjects) * 100 : 0;
        const threshold = context.redThresholdPercentage || 30;

        let calculatedHealth = 'Green';
        let healthRationale = '';
        if (redPercentage >= threshold) {
            calculatedHealth = 'Red';
            healthRationale = `CRITICAL: ${redCount}/${totalProjects} projects are RED today (${redPercentage.toFixed(1)}%). Exceeds ${threshold}% threshold.`;
        } else if (redCount > 0 || amberCount > 0) {
            calculatedHealth = 'Amber';
            healthRationale = `WARNING: ${redCount} Red, ${amberCount} Amber projects today. Below ${threshold}% Red threshold.`;
        } else {
            calculatedHealth = 'Green';
            healthRationale = 'All projects healthy today.';
        }

        const prompt = `
        ### GLOBAL OMISSION RULE — MANDATORY:
        Only make claims that are directly supported by data provided in this prompt.
        If you cannot verify a claim, OMIT it. Never use hedged language ("possibly", "may be").

        You are a Program Manager Assistant. Generate a **Consolidated Program-Level DAILY Executive Summary** for ${context.date ? `the date ${context.date}` : 'today'} based on the following per-project daily snapshots.

        ### Mandatory Health Assessment:
        - **Calculated Program Health**: ${calculatedHealth}
        - **Rationale**: ${healthRationale}
        - **Red Threshold**: ${threshold}%
        - You MUST respect this calculated health. Do NOT override it.

        ### Project Daily Snapshots:
        ${buildEntityBlock(projectDailyInputs, { label: 'program daily inputs', maxTotal: 40000 })}

        ${managerInsights ? `### Manager Insights (Program-Level Human Context):
        These observations were captured by project leads/managers today. Incorporate key themes into the "summary".
        "${managerInsights}"
        ` : ''}

        ### Instructions:
        1. **TEMPORAL ACCURACY**: Use only durations explicitly stated in snapshots. NEVER fabricate ("blocked for three days", "ongoing for weeks") unless it appears verbatim in the input. Default to "currently blocked" / "ongoing".
        2. **PRODUCTION BUG ACCURACY**: Do not re-label "test defect" or "QA issue" as "production bug" — only use that term if a snapshot explicitly says so.
        3. **Executive Summary**:
           - Synthesize a high-level DAILY narrative (2-3 sentences). The audience is the program owner reviewing today's status.
           - NO Jira ticket keys (e.g. PROJ-123) and no ticket titles.
           - If a project's snapshot is "Unknown" / "No data", do NOT describe it as failure — list as "Data Unavailable" or simply omit. These do not contribute to health.
           - Focus on the day's deliveries, blockers, and risk posture.
        4. **Risk Management**:
           - If ANY project is RED (not Unknown), it MUST be mentioned. Use exact temporal language from the snapshot.
           - "red_projects" must list ONLY genuine RED-status projects, never Unknown ones.
        5. **Action Items**: Specific next steps the program owner could take today/tomorrow to unblock or escalate.

        ${DEPLOYMENT_PENDING_EXCLUSION}
        ${REOPENED_SUBBUG_INFORMATIONAL}

        Return ONLY a JSON object:
        {
           "summary": "Daily executive narrative (2-3 sentences). NO TICKET KEYS.",
           "key_accomplishments": ["What landed today across the program. ${projectDailyInputs.length > 1 ? "Format: '[Project Name]: Accomplishment'. If program-wide, omit brackets." : "Do NOT prefix with project name."} NO TICKET KEYS."],
           "risks": {
               "summary": "2-3 line summary of today's risks across the program.",
               "items": ["Top risks. ${projectDailyInputs.length > 1 ? "Format: '[Project Name]: Risk description'." : "Do NOT prefix with project name."} NO TICKET KEYS."]
           },
           "action_items": ["Specific next steps for the program owner. ${projectDailyInputs.length > 1 ? "Format: '[Project Name]: Action item'. If program-wide, omit brackets." : "Do NOT prefix with project name."}"],
           "red_projects": ["Project A", "Project B"],
           "health": "${calculatedHealth}",
           "notes": "Additional observations."
        }
        `;

        try {
            const response = await this.anthropic.messages.create({
                model: "claude-sonnet-4-5-20250929",
                max_tokens: 3072,
                temperature: 0.2,
                system: prompt,
                messages: [
                    { role: "user", content: "Generate program daily summary." }
                ]
            });

            recordAiUsage('program-daily-summary', response.model, response.usage);

            const content = (response.content[0] as any).text;
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : content;
            return JSON.parse(jsonStr);
        } catch (error) {
            console.error("Program daily AI Analysis Failed:", error);
            return {
                summary: "Error generating program daily summary.",
                risks: { summary: '', items: [] },
                health: "Unknown",
                key_accomplishments: [],
                red_projects: [],
                action_items: [],
            };
        }
    }

    async generateMonthlySummary(
        weeklySummaries: any[],
        options: { managerInsights?: string } = {}
    ): Promise<any> {
        const managerContext = options.managerInsights?.trim()
            ? `\n\n    ### Manager's Additional Context (incorporate into analysis — do NOT echo verbatim):\n    ${options.managerInsights.trim()}\n`
            : '';
        const prompt = `
        ### GLOBAL OMISSION RULE — MANDATORY:
        Only make claims that are directly supported by data provided in this prompt.
        If you cannot verify a claim from the data above, OMIT it entirely.
        Do NOT use hedged language ("possibly", "may be", "appears to") for unverifiable claims — simply omit them.
        A shorter, accurate report is always better than a longer report with uncertain claims.

        You are a Project Manager Assistant. Generate a **Monthly Project Executive Summary** based on the following weekly reports.${managerContext}

        ### Weekly Reports:
        ${buildEntityBlock(weeklySummaries, { label: 'weekly summaries', fieldMax: 1000, maxTotal: 30000 })}

        ### CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):
        1. **TEMPORAL ACCURACY**:
           - **NEVER** invent or extrapolate time durations beyond what's in the weekly reports.
           - If a weekly report says "blocked for 2 days", use that EXACT phrase. Do NOT say "blocked for weeks".
           - Do NOT aggregate durations (e.g., don't say "blocked for 3 weeks" if each week mentions a 2-day block).
           - ONLY describe patterns that span multiple weeks if EXPLICITLY documented in multiple weekly reports.
           - FORBIDDEN: "blocked for entire month", "ongoing for 4 weeks" (unless explicitly stated in source)
           - ALLOWED: "blocked in week 1 and week 3", "recurring blocker across the month"

        2. **DATA GROUNDING**:
           - Every risk or achievement must come from the weekly reports provided.
           - Do NOT infer trends that aren't clearly visible in the data.
           - When describing risks, copy the EXACT temporal language from weekly reports.

        2b. **PRODUCTION BUG ACCURACY**:
           - Do NOT re-classify test defects or QA issues as production bugs when aggregating weekly reports.
           - Only use "production bug" or "production incident" if a weekly report explicitly uses that term.
           - If a weekly report says "test defect" or "QA issue", preserve that framing — do NOT escalate it.

        3. **RISK AGGREGATION**:
           - If the same blocker appears in multiple weeks, say: "recurring blocker across weeks X, Y, Z"
           - Do NOT invent cumulative durations - track occurrences instead.

        4. **NO TICKET DETAILS**:
           - Do NOT mention Jira ticket IDs (e.g. "PROJ-123"), ticket titles, sprint counts, story point counts, or task/ticket numbers.
           - Describe work by feature names, modules, or capability outcomes instead.

        ### Instructions:
        1. **Aggregate**: Synthesize the narrative of the month's progress. No ticket counts or IDs.
        2. **Achievements**: Highlight key milestones and specific features/modules completed this month (e.g. "launched payment module", "completed API integration"). Be concrete about what was delivered. No counts of tickets or sprints.
        3. **Risks**: Identify ALL systemic risks or blockers that persisted throughout the month. Do NOT omit or soften risks — every significant blocker must surface. Use EXACT temporal language from source.
        4. **Health**: Determine overall monthly health (Green/Amber/Red).
        ${DEPLOYMENT_PENDING_EXCLUSION}
        ${REOPENED_SUBBUG_INFORMATIONAL}

        ### JSON Output Format:
        Return ONLY a JSON object:
        {
           "work_summary": "High-level summary of the month's delivery.",
           "achievements": "Key milestones reached.",
           "risks": "Persistent risks.",
           "status": "Green, Amber, or Red"
        }
        `;

        try {
            const response = await this.anthropic.messages.create({
                model: "claude-sonnet-4-5-20250929",
                max_tokens: 4096,
                temperature: 0.2,
                system: prompt,
                messages: [
                    { role: "user", content: "Generate monthly summary." }
                ]
            });

            recordAiUsage('monthly-summary', response.model, response.usage);

            const content = (response.content[0] as any).text;
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : content;

            return JSON.parse(jsonStr);

        } catch (error) {
            console.error("Monthly AI Analysis Failed:", error);
            return {
                work_summary: "Error generating monthly summary.",
                achievements: "",
                risks: "",
                status: "Unknown"
            };
        }
    }

    async consolidateSharedTeamReports(
        teamName: string,
        aggregatedReports: string,
        teamMembers: string[]
    ): Promise<AnalysisResult> {
        const prompt = `
        You are a Program Manager Assistant. You are task with generating a **Consolidated Daily Status Report** for a shared/cross-functional team ("${teamName}").
        
        This team works across multiple projects. Below is the aggregated activity for the team members (${teamMembers.join(', ')}) from the various projects they contributed to today.

        ### Aggregated Project Reports:
        ${aggregatedReports}

        ### Instructions:
        1. **Synthesize**: Create a single, cohesive "Work Summary" that explains what this shared team (and specifically these members) accomplished across all projects.
        2. **Executive Summary**: 2-3 concise sentences summarizing the aggregate impact today.
        3. **Risks**: Identify any critical blockers or risks mentioned in the individual project reports that affect these shared team members.
        4. **Plan**: Synthesize a "Plan for Tomorrow" based on the next steps mentioned in the projects.
        5. **Health**: Determine an overall health for this shared team's work today (Green/Amber/Red).
        6. **Formatting**: Group the Work Summary logically (e.g., by Project or by Theme, whichever is clearer).

        ### CRITICAL ANTI-HALLUCINATION RULES:
        - Do NOT mention tickets or work that were NOT in the provided aggregated reports.
        - Do NOT invent progress.
        - If a project report lists "No activity", ignore it unless it's the ONLY project.
        ${DEPLOYMENT_PENDING_EXCLUSION}
        ${REOPENED_SUBBUG_INFORMATIONAL}

        Return ONLY a JSON object:
        {
            "health": "Green/Amber/Red",
            "executiveSummary": "Concise summary.",
            "keyRisks": "Top risks.",
            "executivePlan": "Primary goal.",
            "planForTomorrow": "Next steps.",
            "risks": "Details of blockers.",
            "notes": "Observations.",
            "workSummary": "Bulleted synthesis of work."
        }
        `;

        try {
            const response = await this.anthropic.messages.create({
                model: "claude-sonnet-4-5-20250929",
                max_tokens: 4096,
                temperature: 0.2,
                system: prompt,
                messages: [
                    { role: "user", content: "Consolidate these reports." }
                ]
            });

            recordAiUsage('shared-team-consolidation', response.model, response.usage);

            const content = (response.content[0] as any).text;
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : content;

            return JSON.parse(jsonStr);

        } catch (error) {
            console.error("Shared Team Consolidation Failed:", error);
            return {
                workSummary: "Error consolidating reports.",
                planForTomorrow: "",
                risks: "",
                notes: "",
                health: "Unknown",
                executiveSummary: "Error",
                keyRisks: "Unknown",
                executivePlan: ""
            };
        }
    }

    /**
     * Collates multiple daily manager insights (from Mon-Fri snapshots) into a
     * concise weekly project-level narrative. Used during WSR generation.
     */
    async collateWeeklyInsights(dailyInsights: string[], projectName: string): Promise<string> {
        if (!dailyInsights || dailyInsights.length === 0) return '';

        const prompt = `
        You are a Project Manager Assistant. The following manager insights were captured on individual days this week for the project "${projectName}".
        These are raw notes from team leads about escalations, customer concerns, and observations not captured in Jira.

        Daily insights (in chronological order):
        ${dailyInsights.map((ins, i) => `Day ${i + 1}: ${ins}`).join('\n')}

        Synthesize these into a single concise paragraph (3-5 sentences) that captures the key themes, escalations, and concerns for the week.
        - Focus on patterns and recurring concerns.
        - Write in a professional tone suitable for management.
        - Do NOT include Jira ticket IDs or ticket titles.
        - Return ONLY the paragraph text, no JSON, no headers.
        `;

        try {
            const response = await this.anthropic.messages.create({
                model: "claude-sonnet-4-5-20250929",
                max_tokens: 512,
                temperature: 0.2,
                system: prompt,
                messages: [{ role: "user", content: "Collate these daily insights into a weekly summary." }]
            });

            recordAiUsage('collate-weekly-insights', response.model, response.usage);
            return ((response.content[0] as any).text || '').trim();
        } catch (error) {
            console.error("collateWeeklyInsights failed:", error);
            return dailyInsights.join(' | ');
        }
    }

    /**
     * Collates project-level weekly insights into an account-level narrative.
     * Used during account WSR generation.
     */
    async collateAccountInsights(
        projectInsights: { projectName: string; insights: string }[]
    ): Promise<string> {
        if (!projectInsights || projectInsights.length === 0) return '';

        const prompt = `
        You are a Program Manager Assistant. The following manager insights were captured for individual projects this week.
        These represent ground-level observations, escalations, and customer concerns not captured in Jira.

        Project insights:
        ${projectInsights.map(p => `[${p.projectName}]: ${p.insights}`).join('\n\n')}

        Synthesize these into a concise account-level narrative (3-5 sentences) that captures key themes across projects.
        - Highlight cross-project concerns or patterns.
        - Write in a professional tone for senior management.
        - Do NOT include Jira ticket IDs or ticket titles.
        - Return ONLY the paragraph text, no JSON, no headers.
        `;

        try {
            const response = await this.anthropic.messages.create({
                model: "claude-sonnet-4-5-20250929",
                max_tokens: 512,
                temperature: 0.2,
                system: prompt,
                messages: [{ role: "user", content: "Collate project insights into account-level summary." }]
            });

            recordAiUsage('collate-account-insights', response.model, response.usage);
            return ((response.content[0] as any).text || '').trim();
        } catch (error) {
            console.error("collateAccountInsights failed:", error);
            return projectInsights.map(p => `[${p.projectName}]: ${p.insights}`).join(' | ');
        }
    }

    /**
     * Prompt-engineering coaching for one engineer, derived ONLY from aggregate,
     * content-free signals (never prompt text, code, or file names — those never
     * leave the engineer's machine). Returns 3 short, actionable tips.
     */
    async generatePromptCoaching(agg: {
        prompts: number;
        avgScore: number;
        goodPct: number;
        okPct: number;
        poorPct: number;
        noContextPct: number;
        reworkPct: number;
        vaguePct: number;
        veryShortPct: number;
        structuredRatioPct: number;
        toolAssistedPct: number;
        skillInvocations: number;
        mcpCalls: number;
        vibeIndex: number;
    }): Promise<string[]> {
        const prompt = `
        You are a senior engineer coaching a teammate on prompt engineering with an AI coding assistant.
        You are given ONLY aggregate, anonymous statistics about how they prompted over a period.
        You have NO access to their actual prompts, code, or files, and must never invent any.

        Their stats:
        - Prompts scored: ${agg.prompts}; average quality score: ${agg.avgScore}/100 (Good ${agg.goodPct}%, OK ${agg.okPct}%, Poor ${agg.poorPct}%)
        - Share of prompts with no context (no file/error/path): ${agg.noContextPct}%
        - Rapid re-prompt (rework) rate: ${agg.reworkPct}%
        - Vague commands: ${agg.vaguePct}%; very short/underspecified: ${agg.veryShortPct}%
        - Structured-help ratio (tools/skills/MCP vs free-text): ${agg.structuredRatioPct}%; tool-assisted turns: ${agg.toolAssistedPct}%
        - Skill invocations: ${agg.skillInvocations}; MCP calls: ${agg.mcpCalls}
        - Vibe-coding index (0-100, higher = less structured): ${agg.vibeIndex}

        Write EXACTLY three short, specific, encouraging coaching tips prioritised by the biggest opportunity in the stats above.
        - Each tip is one or two sentences, concrete and actionable.
        - Reference the relevant statistic where useful.
        - Do NOT invent examples of their prompts or mention any code/file/project.
        - Return ONLY a JSON array of three strings, nothing else.
        `;

        try {
            // ADDENDUM 20/21 item 7: narrow, template-shaped task (turn precomputed
            // aggregate stats into 3 short coaching sentences) — well within Haiku's
            // capability. Spot-checked against Sonnet on a real profile before
            // switching (comparable quality, faster, cheaper); already bounded to
            // ≤1 real call/user/7 days by the Phase 2 cooldown, so this compounds
            // an already-small cost.
            const response = await this.anthropic.messages.create({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 512,
                temperature: 0.3,
                system: prompt,
                messages: [{ role: "user", content: "Give three prompt-engineering coaching tips based on these stats." }]
            });

            recordAiUsage('prompt-coaching', response.model, response.usage);
            const text = ((response.content[0] as any).text || '').trim();
            const match = text.match(/\[[\s\S]*\]/);
            if (match) {
                const arr = JSON.parse(match[0]);
                if (Array.isArray(arr)) {
                    return arr.map((s) => String(s)).filter(Boolean).slice(0, 3);
                }
            }
            // Fallback: split into non-empty lines if the model didn't return JSON.
            return text.split('\n').map((l: string) => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean).slice(0, 3);
        } catch (error) {
            console.error("generatePromptCoaching failed:", error);
            return [];
        }
    }

    /**
     * Synthesizes an executive narrative for the multi-project Portfolio
     * (Delivery) Presentation. Two-tier hierarchy: callers pre-collate per
     * project (e.g. via collateWeeklyInsights) so this prompt sees N short
     * digests rather than N x 30 raw daily notes. Numbers are NOT generated
     * here - the caller appends a deterministic metric footer.
     */
    async generatePortfolioExecutiveSummary(params: {
        accountName: string;
        scopeLabel?: string;
        startDate: string;
        endDate: string;
        overallHealth: string;
        projectSummaries: Array<{
            projectName: string;
            collatedInsights?: string;
            wsrExecSummaries?: string[];
            achievements?: string[];
            risks?: string[];
        }>;
    }): Promise<string> {
        const { accountName, scopeLabel, startDate, endDate, overallHealth, projectSummaries } = params;
        if (!projectSummaries || projectSummaries.length === 0) return '';

        const scope = scopeLabel ? `${scopeLabel} ("${accountName}")` : `account "${accountName}"`;

        const projectBlocks = projectSummaries.map(p => {
            const sections: string[] = [];
            if (p.collatedInsights) sections.push(`Manager insights digest: ${p.collatedInsights}`);
            if (p.wsrExecSummaries && p.wsrExecSummaries.length > 0) {
                sections.push(`Recent weekly exec summaries: ${p.wsrExecSummaries.join(' || ').slice(0, 1500)}`);
            }
            if (p.achievements && p.achievements.length > 0) {
                sections.push(`Achievements: ${p.achievements.slice(0, 5).join('; ')}`);
            }
            if (p.risks && p.risks.length > 0) {
                // Surface ALL risks (the prompt mandates "do NOT omit"); cap generously to avoid
                // dropping a Red project's blockers, which a tight slice(0,5) used to do silently.
                sections.push(`Risks/blockers: ${p.risks.slice(0, 20).join('; ')}`);
            }
            return `### ${p.projectName}\n${sections.join('\n')}`;
        }).join('\n\n');

        const prompt = `
        You are a Senior Delivery Manager Assistant. Write the executive summary for a multi-project delivery review covering ${scope} for the window ${startDate} to ${endDate}.

        ### Per-project context
        ${projectBlocks}

        ### Overall health rollup
        ${overallHealth}

        ### Instructions
        - Write 3 to 5 sentences in a single paragraph for senior executives who do NOT have Jira access.
        - Lead with what was actually delivered (themes, customer outcomes), then cross-project patterns, then notable risks.
        - Surface concerns that recur across projects - that signal matters more than per-project noise.
        - Do NOT include Jira ticket IDs (e.g. PROJ-123) or verbatim ticket titles.
        - Do NOT restate dates, project counts, or numeric metrics - those are appended separately as a metric footer.
        - Do NOT use percentages.
        - Do NOT use temporal shorthand like "this week", "this sprint", "this fortnight", "this month", or "this quarter" - the review window can span any duration. Use neutral phrasing such as "during this review period", "across the window", or "in this delivery cycle".
        - Return ONLY the paragraph text. No JSON, no headers, no quotes.
        ${DEPLOYMENT_PENDING_EXCLUSION}
        ${REOPENED_SUBBUG_INFORMATIONAL}

        ${overallHealth !== 'Green' ? `
        ### HEALTH INTEGRITY GUARDRAIL (MANDATORY)
        Overall health is **${overallHealth}** based on objective rollup of project signals.
        - You MAY include positive context from manager insights and achievements.
        - You MUST still convey the ${overallHealth} concern. The summary cannot read as if everything is fine.
        - Devote at least one sentence to the challenges or risks driving the ${overallHealth} status.
        - Suggested balance: "While [positive context], the portfolio continues to face [challenge], warranting close attention."
        - NOT PERMITTED: a summary so positive it misleads readers into thinking delivery is on track when it is not.
        ` : ''}
        `;

        try {
            const response = await this.anthropic.messages.create({
                model: "claude-sonnet-4-5-20250929",
                max_tokens: 600,
                temperature: 0.2,
                system: prompt,
                messages: [{ role: "user", content: "Write the portfolio executive summary." }]
            });

            recordAiUsage('portfolio-exec-summary', response.model, response.usage);
            return ((response.content[0] as any).text || '').trim();
        } catch (error) {
            console.error("generatePortfolioExecutiveSummary failed:", error);
            return '';
        }
    }

    /**
     * Generates a refreshed executive summary incorporating manager insights.
     * Used when a manager adds/edits insights after a report is already generated.
     */
    async refreshExecutiveSummary(params: {
        reportType: 'daily' | 'weekly_project' | 'weekly_account' | 'monthly_project' | 'monthly_account';
        projectName: string;
        workSummary: string;
        health: string;
        existingRisks: string;
        managerInsights: string;
    }): Promise<string> {
        const { reportType, projectName, workSummary, health, existingRisks, managerInsights } = params;

        const scopeLabel = reportType === 'daily' ? 'daily'
            : reportType === 'weekly_project' ? 'weekly'
            : reportType === 'weekly_account' ? 'account-level weekly'
            : reportType === 'monthly_project' ? 'monthly project'
            : 'account-level monthly';

        const prompt = `
        You are a Project Manager Assistant. Rewrite the executive summary for the ${scopeLabel} report for "${projectName}".

        ### Current Report Context:
        - Overall Health: ${health}
        - Work Summary (what happened): ${workSummary}
        - Risks/Blockers: ${existingRisks || 'None identified.'}

        ### Manager Insights (Human context — escalations, customer concerns, observations NOT in Jira):
        "${managerInsights}"

        ### Instructions:
        - Write 2-3 concise sentences that summarize the functional progress AND weave in the key themes from manager insights.
        - Focus on business outcomes and themes — NO Jira ticket IDs (e.g., PROJ-123) or verbatim ticket titles.
        - Write for senior executives who do NOT have Jira access.
        - Do NOT use percentages.
        - Return ONLY the summary text (no JSON, no headers, no quotes).
        ${DEPLOYMENT_PENDING_EXCLUSION}
        ${REOPENED_SUBBUG_INFORMATIONAL}

        ${health !== 'Green' ? `
        ### HEALTH INTEGRITY GUARDRAIL (MANDATORY):
        The overall health is **${health}**, based on objective board data (blocked tickets, defects, velocity).
        Known challenges: ${existingRisks || 'see work summary above'}

        When incorporating manager insights into a ${health} health report:
        - You MAY include positive progress or context from manager insights — human perspective adds value.
        - You MUST still convey the ${health} concern. The summary cannot read as if everything is fine.
        - Devote at least one sentence to the challenges or risks driving the ${health} status.
        - Suggested balance: "While [positive manager context], [project/account] continues to face [challenge], and warrants close attention."
        - NOT PERMITTED: A summary so positive it misleads readers into thinking the project is healthy.
        - Goal: honest, balanced, and diplomatic — the manager's voice is heard, delivery integrity is preserved.
        ` : ''}
        `;

        try {
            const response = await this.anthropic.messages.create({
                model: "claude-sonnet-4-5-20250929",
                max_tokens: 512,
                temperature: 0.2,
                system: prompt,
                messages: [{ role: "user", content: "Refresh the executive summary with manager insights." }]
            });

            recordAiUsage('refresh-exec-summary', response.model, response.usage);
            return ((response.content[0] as any).text || '').trim();
        } catch (error) {
            console.error("refreshExecutiveSummary failed:", error);
            throw error;
        }
    }

    async generateMonthlyAccountSummary(
        projectSummaries: any[],
        context: { accountId?: number; redThresholdPercentage?: number; managerInsights?: string } = {}
    ): Promise<any> {
        // Deterministic health calculation (same logic as generateAccountSummary)
        const activeProjects = projectSummaries.filter(p => p.status !== 'Unknown' && p.status !== null && p.status !== undefined);
        const totalProjects = activeProjects.length;

        const redProjects = activeProjects.filter(p => p.status === 'Red');
        const amberProjects = activeProjects.filter(p => p.status === 'Amber');

        const redCount = redProjects.length;
        const amberCount = amberProjects.length;
        const redPercentage = totalProjects > 0 ? (redCount / totalProjects) * 100 : 0;

        const threshold = context.redThresholdPercentage || 30;

        let calculatedHealth = 'Green';
        let healthRationale = '';

        if (redPercentage >= threshold) {
            calculatedHealth = 'Red';
            healthRationale = `CRITICAL: ${redCount}/${totalProjects} projects are RED (${redPercentage.toFixed(1)}%). Exceeds threshold of ${threshold}%.`;
        } else if (redCount > 0 || amberCount > 0) {
            calculatedHealth = 'Amber';
            healthRationale = `WARNING: ${redCount} Red projects and ${amberCount} Amber projects present. Below ${threshold}% threshold for Account Red.`;
        } else {
            calculatedHealth = 'Green';
            healthRationale = 'All projects are healthy.';
        }

        const prompt = `
    ### GLOBAL OMISSION RULE — MANDATORY:
    Only make claims that are directly supported by data provided in this prompt.
    If you cannot verify a claim from the data above, OMIT it entirely.
    Do NOT use hedged language ("possibly", "may be", "appears to") for unverifiable claims — simply omit them.
    A shorter, accurate report is always better than a longer report with uncertain claims.

    You are a Senior Program Director preparing a **Monthly Business Review (MBR)** presentation for CXO and VP-level customer stakeholders. Generate a consolidated, executive-grade account summary based on the following monthly project data.

    ### Mandatory Health Assessment (INTERNAL CONTEXT ONLY — do NOT echo in any output field):
    - **Calculated Account Health**: ${calculatedHealth}
    - **Rationale**: ${healthRationale}
    - You MUST use this calculated health value in the "health" field. Do NOT override it.
    - NEVER mention this rationale, project counts, or health color names (Red/Amber/Green) in any written text field.

    ### Monthly Project Data (internal context — do NOT expose project names in output):
    ${buildEntityBlock(projectSummaries, { label: 'monthly account project summaries', maxTotal: 40000 })}
    ${context.managerInsights?.trim() ? `\n    ### Account Manager's Context (incorporate — do NOT echo verbatim):\n    ${context.managerInsights.trim()}\n` : ''}
    ### CRITICAL OUTPUT RULES (MANDATORY — violation renders output unusable):
    1. **NO DIGITS**: Never use numerals (0-9) in any text field. Write numbers as words: "three" not "3". Use "several", "a number of", "select", "multiple" instead of exact counts.
    2. **NO HEALTH STATUS COUNTS**: Never say "X Red projects", "X Amber projects", or any project-count-by-color. The health badge is displayed separately. Describe business themes, not status distributions.
    3. **NO PROJECT NAMES** (with ONE exception): Do NOT mention individual project/workstream names in the summary, risks, or annexure. DO include specific feature names, module names, integrations, and technical deliverables — these make highlights credible (e.g. "payment gateway integration", "mobile onboarding flow", "data analytics dashboard", "authentication service hardening"). EXCEPTION — only when there is more than one project, Key Accomplishments and Action Items MUST be prefixed with "[Project Name]: " to attribute each item to its project (omit the bracket for genuinely account-wide items).
    4. **NO TICKET DETAILS**: No Jira IDs (e.g. "PROJ-123"), no ticket titles, no ticket/sprint counts, no story point numbers, no "X tasks completed" phrasing. Describe work by feature or capability outcome only.
    5. **BUSINESS LANGUAGE**: "blocked tickets" → "delivery dependencies requiring resolution". Technical terms are fine when they describe a deliverable (e.g. "API rate-limiting controls", "cloud migration milestone").
    6. **SURFACE ALL RISKS**: Every significant risk from the source data MUST appear in the risks output. Do NOT merge, soften, or omit risks. If a project is Red status, its blockers are critical — include them explicitly with direct, clear language. A CXO expects to hear bad news, not sanitised summaries.
    7. **PRODUCTION BUG ACCURACY**: Do NOT re-classify test defects, Sub-bug issues, or QA environment defects as production bugs. Only call something a "production incident" if the source monthly project data explicitly labels it as such. Preserve the original framing — "test defect" must not become "production incident".
    ${DEPLOYMENT_PENDING_EXCLUSION}
        ${REOPENED_SUBBUG_INFORMATIONAL}

    ### Output Structure:

    **MAIN SLIDES** — polished, high-level, for the live CXO audience:
    1. **Summary**: 3-4 sentences on business value delivered and overall delivery posture. Mention key features or capabilities enabled this month. No digits, no health counts.
    2. **Key Highlights**: 4-5 bullets. Format: "Headline: brief clause naming the specific feature or capability delivered." Max 18 words each. Include concrete deliverable names.
    3. **Risks**: All significant risk themes — minimum one per Red or Amber project. Format: "Headline: one-sentence concern." Max 20 words each. Do NOT merge multiple risks into one vague bullet.
    4. **Action Items**: Three to four leadership actions. Max 15 words. Start with an action verb.

    **ANNEXURE** — detailed backup slides that appear AFTER the Thank You page. The presenter references these only if the audience asks for elaboration on a specific theme. Annexure sections must correspond to themes raised in the main slides (e.g. if risks mention "quality concerns", there must be a "Quality Assurance — Detail" annexure). Annexure may be more specific and detailed. Still no project names.
    5. **Annexure**: Two to four sections. Each section: a short title + three to six explanatory bullet points that give the presenter enough context to answer follow-up questions.

    Return ONLY a JSON object:
    {
       "summary": "3-4 sentence CXO narrative. No digits. No health counts. No project names.",
       "key_accomplishments": ["${projectSummaries.length > 1 ? "[Project Name]: " : ""}Headline: brief outcome. Max 18 words. (4-5 items)${projectSummaries.length > 1 ? " Prefix each item with its '[Project Name]: ' (omit for account-wide items)." : ""}"],
       "risks": {
           "summary": "2-3 sentence risk posture overview. No digits. No health counts.",
           "items": ["Headline: one-sentence strategic concern. Max 18 words. (3-4 items)"]
       },
       "action_items": ["${projectSummaries.length > 1 ? "[Project Name]: " : ""}Action verb + directive. Max 15 words. (3-4 items)${projectSummaries.length > 1 ? " Prefix each item with its '[Project Name]: ' (omit for account-wide items)." : ""}"],
       "annexure": [
           {
               "title": "Section Title (e.g. Quality Assurance Detail, Delivery Dependency Status, Platform Stability Detail)",
               "points": ["Detailed bullet that elaborates on the corresponding main-slide theme. No project names. (3-6 points)"]
           }
       ],
       "red_projects": ["Project A"],
       "health": "${calculatedHealth}"
    }
    `;

        try {
            const response = await this.anthropic.messages.create({
                model: "claude-sonnet-4-5-20250929",
                max_tokens: 6000,
                temperature: 0.2,
                system: prompt,
                messages: [
                    { role: "user", content: "Generate monthly account summary." }
                ]
            });

            recordAiUsage('monthly-account-summary', response.model, response.usage);

            const content = (response.content[0] as any).text;
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : content;

            return JSON.parse(jsonStr);

        } catch (error) {
            console.error("Monthly Account AI Analysis Failed:", error);
            return {
                summary: "Error generating monthly account summary.",
                key_accomplishments: [],
                red_projects: [],
                risks: { summary: '', items: [] },
                action_items: [],
                health: "Unknown"
            };
        }
    }

    /**
     * Analyses manager insights text and suggests a health escalation if warranted.
     * ONLY escalates — never suggests a lower health than the current computed value.
     * Returns null if no escalation is needed.
     */
    async analyzeInsightsForHealth(
        insights: string,
        computedHealth: string,
        projectName: string
    ): Promise<{ suggestedHealth: string; reason: string } | null> {
        // If already Red, nothing to escalate to
        if (computedHealth === 'Red') return null;

        const prompt = `
        You are a Project Risk Analyst. A team lead has added the following manager insights for project "${projectName}".
        The project's current algorithmically computed health is: ${computedHealth}.

        Manager Insights:
        "${insights}"

        Your task: determine whether these insights contain evidence of real escalation risk that warrants raising the health signal.
        Escalation signals to look for:
        - Customer escalations or complaints
        - Team-member conflicts, attrition risk, or HR concerns
        - Delivery blockers not captured in the Jira board
        - Stakeholder dissatisfaction or executive concerns
        - Critical issues being deliberately deferred

        Rules:
        - You may only suggest a health level MORE severe than "${computedHealth}" (Green < Amber < Red).
        - If insights describe routine progress, minor issues, or no clear risk → return suggestedHealth as null.
        - Do NOT escalate for vague or speculative concerns.
        - The reason must be ≤ 20 words, written for senior management.

        CRITICAL: Respond with ONLY a raw JSON object. No markdown, no code fences, no explanation.
        Exactly one of these two forms:
        {"suggestedHealth": "Amber", "reason": "One concise reason sentence here."}
        {"suggestedHealth": null}
        `;

        try {
            const response = await this.anthropic.messages.create({
                model: "claude-sonnet-4-5-20250929",
                max_tokens: 128,
                temperature: 0.1,
                system: prompt,
                messages: [{ role: "user", content: "Analyse the insights and respond with raw JSON only." }]
            });

            recordAiUsage('insights-health-check', response.model, response.usage);
            const raw = ((response.content[0] as any).text || '').trim();
            // Strip markdown code fences if AI wraps the JSON (e.g. ```json ... ```)
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
            const parsed = JSON.parse(cleaned);
            if (!parsed.suggestedHealth) return null;

            // Enforce escalation-only: reject if suggestion is not more severe
            const severity: Record<string, number> = { Green: 1, Amber: 2, Red: 3 };
            const currentSev = severity[computedHealth] || 1;
            const suggestedSev = severity[parsed.suggestedHealth] || 1;
            if (suggestedSev <= currentSev) return null;

            return { suggestedHealth: parsed.suggestedHealth, reason: parsed.reason || '' };
        } catch (error) {
            console.error("analyzeInsightsForHealth failed:", error);
            return null; // fail silently — health suggestion is non-critical
        }
    }

    async generatePortfolioMOM(reportData: any, transcript: string): Promise<string> {
        const account = reportData.account || {};

        // Structuring contract: the user's notes are the entire content. The AI
        // organizes them into four fixed MOM sections and polishes language — it
        // does NOT invent decisions, action items, owners, or padding. The
        // presentation/PDF already covers metrics — the MOM is the human record.
        const systemPrompt = 'You are a meeting secretary producing Minutes of Meeting. The user has written raw notes from a meeting. Your job is to ORGANIZE those notes into four fixed sections and polish the language — NOT to interpret, expand, or add content the user did not write.\n\n'
            + 'OUTPUT MUST START WITH THIS HEADER (plain text, exactly as shown, fill in the values):\n'
            + 'MINUTES OF MEETING\n'
            + '------------------\n'
            + 'Account:        ' + (account.name || '-') + '\n'
            + 'Meeting:        ' + (reportData.title || '-') + '\n'
            + 'Meeting Date:   ' + (reportData.meetingDate || '-') + '\n'
            + 'Window Reviewed: ' + (reportData.startDate || '-') + ' to ' + (reportData.endDate || '-') + '\n\n'
            + '------------------\n\n'
            + 'After the header, output EXACTLY these four sections IN THIS ORDER, each heading on its own line in UPPERCASE followed by its bullets:\n'
            + 'DISCUSSION POINTS\n'
            + 'DECISIONS\n'
            + 'ACTION ITEMS\n'
            + 'CLOSING REMARK\n\n'
            + 'HOW TO FILL THE SECTIONS:\n'
            + '- DISCUSSION POINTS: topics discussed, updates shared, questions raised.\n'
            + '- DECISIONS: only choices the user explicitly stated were decided/agreed.\n'
            + '- ACTION ITEMS: follow-ups/tasks. Where the user gave an owner and/or deadline ("Ravi - by Fri"), keep it intact at the end of the bullet.\n'
            + '- CLOSING REMARK: a one-line wrap-up ONLY if the user wrote one; otherwise "• None recorded.".\n'
            + '- Categorize each note into the single best-fitting section. If a section has no matching content, output exactly one bullet under it: "• None recorded." — do NOT fabricate to fill it.\n\n'
            + 'HOW TO POLISH (what you MAY do):\n'
            + '- Fix typos, grammar, punctuation, and casing.\n'
            + '- Format every point as a bullet starting with "• " (one idea per line). Prefer short, punchy bullets over prose.\n'
            + '- Tighten wordy sentences into crisp phrases — cut filler ("we discussed that", "it was noted that"). Keep the facts, drop the padding.\n'
            + '- If one line crams several distinct points, split it into separate bullets (same facts, just clearer — add nothing new).\n'
            + '- Use a sub-bullet ("   - ") only to nest a detail directly under its parent point.\n\n'
            + 'WHAT YOU MUST NOT DO:\n'
            + '- Do NOT add any section headings beyond the four above.\n'
            + '- Do NOT pull in any project metrics, sprint numbers, risks, or action items from the presentation context — they are intentionally excluded. The PDF carries those.\n'
            + '- Do NOT infer conclusions, decisions, or owners the user did not explicitly state.\n'
            + '- Do NOT pad sparse notes or invent content. Same information in, just organized, tighter, and bulleted — never longer or more descriptive.\n'
            + '- Do NOT change the meaning, soften disagreements, or rewrite into corporate-speak.\n'
            + '- Do NOT use markdown symbols (no **, no ##, no *, no backticks). The "• " and "   - " bullet characters are fine.\n'
            + '- Do NOT add a closing/signoff/"Best regards" — this is a record, not an email.\n'
            + '- No essay-style prose, no jazzy language. Direct and plain.';

        const response = await this.anthropic.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 4096,
            temperature: 0.1,
            system: systemPrompt,
            messages: [{ role: 'user', content: 'Meeting notes (polish only — keep meaning intact):\n\n' + transcript }],
        });

        recordAiUsage('portfolio-mom', response.model, response.usage);

        return (response.content[0] as any).text || '';
    }

    /**
     * Propose a column mapping for a sample file, from its header row alone.
     *
     * PRIVACY: headers only. No cell values are read or sent, so nothing customer-identifying
     * leaves the server -- a header row is structural, the rows beneath it are not.
     *
     * Returns a draft for the user to review, never an authority: the caller drops any header the
     * model did not actually receive, and a failed call returns {} so the mapping editor still
     * opens for a manual pass.
     */
    async suggestColumnMapping(
        headers: string[],
        fields: ReadonlyArray<{ key: string; label: string }>
    ): Promise<Record<string, string>> {
        if (!headers?.length || !fields?.length) {
            return {};
        }

        const prompt = `
        You map spreadsheet column headers onto the fields of a delivery-tracking system.
        The spreadsheet is an export from a tool such as Jira, Azure DevOps or a hand-maintained tracker.

        Target fields (map to the "key"):
        ${buildEntityBlock(fields as any[], { label: 'mappingFields', fieldMax: 120, maxTotal: 4000 })}

        Column headers available in the file:
        ${buildEntityBlock(headers as any[], { label: 'sampleHeaders', fieldMax: 200, maxTotal: 8000 })}

        Rules:
        - Return ONLY a JSON object of {"fieldKey": "exact header text"}. No prose, no markdown fence.
        - The header value MUST be copied character-for-character from the list above.
        - Omit a field entirely when no column plausibly matches. A wrong guess is worse than a gap:
          the user reviews this draft, and a confident mistake is the one they will not catch.
        - Map each header to at most one field.
        - Guidance on commonly ambiguous fields:
          * externalId is the ticket/work-item identifier ("ID", "Key", "Issue key"), not a row number.
          * storyPoints is the estimate ("Story Points", "Effort", "Estimate", "Original Estimate").
          * sprintName may appear as "Sprint", "Iteration", "Iteration Path".
          * parentExtId is the parent/epic link ("Parent", "Epic Link", "Parent ID").
          * createdDate is when the item was raised; lastUpdated is the most recent change.
            Prefer an explicit "Created"/"Changed" pair over a generic "Date".
          * assigneeEmail may hold a display name rather than an email; map it anyway.
        `;

        try {
            const response = await this.anthropic.messages.create({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 1024,
                temperature: 0,
                system: prompt,
                messages: [{ role: 'user', content: 'Return the mapping JSON for these headers.' }],
            });

            recordAiUsage('column-mapping', response.model, response.usage);

            const text = ((response.content[0] as any).text || '').trim();
            // Tolerate a fenced or prose-wrapped reply rather than failing the whole suggestion.
            const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);

            if (!json) {
                return {};
            }

            const parsed = JSON.parse(json) as Record<string, unknown>;
            const knownFields = new Set(fields.map(f => f.key));
            const knownHeaders = new Set(headers);
            const suggestions: Record<string, string> = {};

            for (const [key, value] of Object.entries(parsed)) {
                // Only fields we asked about, and only headers the file actually has. A hallucinated
                // header would be stored as a mapping that silently matches no column and imports blank.
                if (knownFields.has(key) && typeof value === 'string' && knownHeaders.has(value)) {
                    suggestions[key] = value;
                }
            }

            return suggestions;
        } catch (error) {
            logger.error('suggestColumnMapping failed; falling back to an empty draft', error as Error, 'AIService');
            return {};
        }
    }

    /**
     * Range-window project narrative (Phase 4 of the RAG-reliability plan) — the prompt
     * previously duplicated inline in generateTwiceWeeklyEmail.ts / generateRangeReport.ts,
     * moved here so it inherits recordAiUsage (those scripts previously called the Anthropic
     * SDK directly, so this spend never appeared in ai_call_usage), and so there is exactly one
     * copy instead of two drifting ones. `rollup` comes from rangeRollupService.rollupProjectRange
     * — its dailySummaries are already scrubbed (confirmed prod bug keys whitelisted), so no
     * caller of this method needs to remember to scrub separately.
     */
    async generateRangeProjectSummary(rollup: import('../../reports/services/rangeRollupService').ProjectRangeRollup): Promise<{ summary: string; risk: string }> {
        const aggregatedContext = rollup.dailySummaries.map(s => {
            const blockedList = s.blocked.length > 0 ? s.blocked.join('; ') : 'None';
            return `\nDate: ${s.date}\nOverall Health: ${s.health}\nHealth Rationale: ${s.healthRationale || 'N/A'}\nExecutive Summary: ${s.summary || 'N/A'}\nRisks: ${s.risks || 'None'}\nBlocked Tickets: ${blockedList}\nPlan for Tomorrow: ${s.plan || 'None'}\n`;
        }).join('\n---\n');

        const prompt = `
You are a project manager reading daily status reports from several days.
Based on the following aggregated daily reports, generate a final summary and risk section.

Write in the neutral, factual tone of a status log entry. Assume the reader mistrusts adjectives.

Rules:
1. Wrap the summary in <summary> tags and the risk assessment in <risk> tags.
2. Do NOT hallucinate. Do not include any information that is not in the aggregated text below.
3. Do not include ticket IDs. Use simple and professional business language.
4. In the summary, talk about overall progress across the days. If any day has a Red or Amber health status, prominently mention the reason and its impact.
5. In the risk section, talk about any blockers, delays, production issues, or health concerns mentioned. Include blocked tickets if any. If there are none, say "None identified."
6. Pay close attention to the Overall Health and Health Rationale fields -- these indicate critical project status signals that must be reflected in your output.
7. Do NOT use superlatives, cheerleading, or velocity commentary. Banned phrases include (case-insensitive) "significant progress", "solid progress", "steady progress", "notable advancement", "advanced significantly", "progressed well", "successfully demonstrating", "keeping the team on track", "strong execution", "maintaining delivery momentum", and any similar praise. Report facts; do not editorialize.
8. Do NOT reference specific dates from within the reporting window (e.g. "On July 2nd", "by July 3rd", "identified on Monday"). Describe outcomes without pinning them to a day.
9. Do NOT include ticket, story, or day counts in the <summary> -- no "X of Y stories completed", no "N working days remaining". Sprint state must be expressed qualitatively as "on track", "behind", or "at risk". No ratios, no percentages.
10. For a blocker that appeared AND was resolved inside the window, write ONE flat sentence noting it existed and was cleared. Do not narrate the timeline; do not repeat it in both <summary> and <risk>.
11. For a blocker still active, mention it once in <risk> with what it is blocking and what unblocks it. Do not restate it in <summary>.

Aggregated Data:
${aggregatedContext}
`;

        const response = await this.anthropic.messages.create({
            model: "claude-sonnet-4-5-20250929",
            max_tokens: 2048,
            temperature: 0.2,
            system: prompt,
            messages: [
                { role: "user", content: "Generate the Summary and Risk report based on the provided data. Wrap the summary in <summary> tags and the risk in <risk> tags." }
            ]
        });

        recordAiUsage('range-project-summary', response.model, response.usage);

        const content = (response.content[0] as any).text;
        const summaryMatch = content.match(/<summary>([\s\S]*?)<\/summary>/i);
        const riskMatch = content.match(/<risk>([\s\S]*?)<\/risk>/i);
        if (summaryMatch && riskMatch) {
            return { summary: summaryMatch[1].trim(), risk: riskMatch[1].trim() };
        }
        const sections = content.split(/Risk:/i);
        if (sections.length > 1) {
            return { summary: sections[0].replace(/Summary:/i, '').trim(), risk: sections[1].trim() };
        }
        return { summary: content.trim(), risk: 'N/A' };
    }

    /**
     * Range-window account briefing (Phase 4). Previously duplicated inline in
     * generateAccountReport.ts / generateRangeAccountReport.ts, with the account's color
     * decided by the AI (`<account_health>` tag, "worst-case principle"). As of this phase the
     * color is 100% deterministic (`rollup.deterministicHealth`, computed by
     * rangeRollupService/healthMath) — the AI is told what it is and asked only to explain it,
     * matching the pattern every other AI call in this app already follows (aiService never
     * decides RAG color, only narrates around a color it's handed).
     */
    async generateRangeAccountBriefing(
        rollup: import('../../reports/services/rangeRollupService').AccountRangeRollup,
        opts: { label: string }
    ): Promise<{
        executiveSummary: string;
        healthExplanation: string;
        projectHighlights: string;
        accountRisks: string;
        projectRisks: string;
        recommendedActions: string;
    }> {
        const projectBlocks = rollup.projects.map(r => {
            const timelineStr = r.healthTimeline.map(t => `${t.date}=${t.health}`).join(', ');
            const latest = r.dailySummaries[r.dailySummaries.length - 1];
            const risksMentioned = r.dailySummaries.map(d => d.risks).filter(x => x && x.toLowerCase() !== 'none');
            const blocked = [...new Set(r.dailySummaries.flatMap(d => d.blocked))];
            return `
PROJECT: ${r.code} - ${r.name}
  Snapshots in window: ${r.snapshotCount}
  Latest Health: ${r.latestHealth}
  Worst Health In Window: ${r.worstHealth}
  Deterministic Rollup Health: ${r.deterministicHealth}
  Health Timeline: ${timelineStr}
  Latest Health Rationale: ${latest?.healthRationale || 'N/A'}
  Latest Executive Summary: ${latest?.summary || 'N/A'}
  Risks Mentioned in DSRs: ${risksMentioned.length > 0 ? risksMentioned.join(' | ') : 'None'}
  Blocked Items: ${blocked.length > 0 ? blocked.join('; ') : 'None'}
  Latest Plan: ${latest?.plan || 'N/A'}
`;
        }).join('\n---\n');

        const riskBlocks = rollup.risks.length === 0 ? 'No tracked risks for this account.' : rollup.risks.map((r: any) => {
            const proj = r.project ? `${r.project.code}` : 'Account-level';
            const assignee = r.assignee ? `${r.assignee.firstName} ${r.assignee.lastName}` : 'Unassigned';
            return `- [${r.priority}] [${r.status}] (${proj}) ${r.title} | Notified: ${r.notifiedDate} | Assignee: ${assignee} | Source: ${r.source}\n  Description: ${r.description}`;
        }).join('\n');

        const prompt = `
You are preparing a senior-management ${opts.label.toLowerCase()} for the "${rollup.accountName}" account covering the period ${rollup.window.startDate} to ${rollup.window.endDate}.

Audience: Senior leadership (VPs, Directors). They want a crisp, honest, decision-ready briefing — not a status dump.

Write in the neutral, factual tone of a status log entry. Assume the reader mistrusts adjectives.

The account's overall health for this period has ALREADY been determined deterministically from the underlying data: ${rollup.deterministicHealth}. Do not contradict this or propose a different color — your job is to explain WHY it is this color, citing specific projects and reasons.

Rules:
1. Output MUST use these tags exactly, in this order:
   <executive_summary>...</executive_summary>
   <health_explanation>...</health_explanation>
   <project_highlights>...</project_highlights>
   <account_risks>...</account_risks>
   <project_risks>...</project_risks>
   <recommended_actions>...</recommended_actions>
2. Do NOT hallucinate. Use only information present in the data below. If something is missing, say so.
3. Do NOT include Jira ticket IDs or verbatim ticket titles. Use professional business language.
4. The <health_explanation> must clearly state WHY the account is the given color, citing specific projects and the reasons (delays, blockers, quality issues, risks, etc.).
5. <project_highlights> should be a short bulleted list, one line per project, leading with the project's color. One crisp line each — no "advancing", "progressing well", "positioned for…" boilerplate.
6. <account_risks> = cross-cutting risks affecting the whole account (resourcing, client relationship, compliance, etc.). <project_risks> = risks scoped to specific projects, grouped by project.
7. <recommended_actions> should be 3-6 concrete, actionable items leadership can decide on.
8. Do NOT use superlatives or cheerleading anywhere in the output. Banned phrases include (case-insensitive) "steady progress", "solid progress", "significant progress", "strong execution", "strong execution momentum", "demonstrates strong momentum", "maintaining delivery momentum", "successfully demonstrating", "notable advancement", "advanced significantly", "progressed well", "keeping the team on track", "excellent", and any similar praise. Report facts; do not editorialize.
9. Do NOT reference day-scale dates from within the reporting window (e.g. "On July 2nd", "by July 3rd", "on Monday", "yesterday", "today"). Cite specific calendar dates only when referencing background events outside the current window (e.g. an escalation from months prior).
10. Sprint / delivery state must be expressed qualitatively as "on track", "behind", or "at risk" — no ticket/story counts, no ratios (no "X of Y", no "N working days remaining"), no percentages in the summary or highlights.
11. For a blocker that opened AND cleared within the window, mention it once in one flat sentence — do not narrate the timeline and do not repeat it across <executive_summary>, <health_explanation>, and <project_risks>.
12. For an active blocker, mention it once in the most specific tag it belongs to (usually <project_risks>). Do not restate it in <executive_summary> unless it materially drives the account color.

=== PROJECT DATA ===
${projectBlocks || 'No project data available in the window.'}

=== TRACKED RISKS ===
${riskBlocks}
`;

        const response = await this.anthropic.messages.create({
            model: "claude-sonnet-4-5-20250929",
            max_tokens: 4096,
            temperature: 0.2,
            system: prompt,
            messages: [
                { role: "user", content: "Generate the senior-management account report using the provided structured tags exactly as specified." }
            ]
        });

        recordAiUsage('range-account-briefing', response.model, response.usage);

        const content = (response.content[0] as any).text;
        const extractTag = (tag: string): string => {
            const m = content.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
            return m ? m[1].trim() : 'N/A';
        };

        return {
            executiveSummary: extractTag('executive_summary'),
            healthExplanation: extractTag('health_explanation'),
            projectHighlights: extractTag('project_highlights'),
            accountRisks: extractTag('account_risks'),
            projectRisks: extractTag('project_risks'),
            recommendedActions: extractTag('recommended_actions'),
        };
    }

    /**
     * Custom Range Report: writes the Achievements narrative from facts that were already
     * reduced to the latest state per ticket. Haiku at temperature 0; the caller caches the
     * result by input hash, which is what makes repeated requests identical. The prompt is
     * plain text on purpose (no backticks in template literals).
     */
    async composeRangeAchievements(factsJson: string): Promise<string> {
        const system = `You write the Achievements section of a project progress report for engineering leads.
You receive JSON facts: the latest known state of each ticket in a date range, plus the most recent daily work summary.

Rules:
- Use ONLY the supplied facts. Do not invent work, dates, numbers, people or outcomes.
- Report the latest state only. Never describe progression, earlier statuses, or what happened on which day.
- Treat tickets with a done, released or production style status as achievements. Mention in-progress work briefly and only as ongoing, never as completed.
- Group related work under short theme headings. Write each theme as one or two descriptive sentences in past tense.
- Do not list ticket keys or ticket IDs in the text. Describe the work in plain language.
- Never call anything a production bug or production defect unless the facts say so explicitly.
- Output format: for each theme, a line starting with ## followed by the theme name, then the paragraph on the next line. No other text, no markdown besides the ## lines.`;

        const response = await this.anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1500,
            temperature: 0,
            system,
            messages: [{ role: "user", content: factsJson }]
        });

        recordAiUsage('custom-range-achievements', response.model, response.usage);
        const block = response.content[0] as any;
        if (!block || block.type !== 'text') {
            throw new Error('Unexpected content type from Anthropic API for range achievements');
        }
        return String(block.text || '').trim();
    }
}

export const aiService = new AIService();
