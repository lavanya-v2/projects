/**
 * Custom Range Report: a consolidated, read-only progress view over up to 15 calendar days,
 * built purely from existing Daily snapshots. Nothing is written to Postgres.
 *
 * Determinism: everything except the Achievements wording is computed by pure functions of
 * the snapshots. The wording comes from a Haiku call at temperature 0 whose output is cached
 * in Redis by a hash of the (already reduced) input, so identical input returns identical text
 * and costs at most one AI call across all users. If AI is unavailable, a deterministic
 * fallback is returned and is NOT cached.
 */
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { Op } from 'sequelize';
import { DailyBoardSnapshot } from '../../../models/DailyBoardSnapshot';
import { Project } from '../../../models/Project';
import { aiService } from '../../ai/services/aiService';
import { config } from '../../../config';
import { logger } from '../../../common/utils';
import { rollupHealth } from './healthMath';
import { istDateStr } from '../queues/jobIds';
import { buildEmlContent, escapeHtml } from '../../../common/emlBuilder';

export const MAX_RANGE_DAYS = 15;
const PROMPT_VERSION = 'v1';
const AI_MODEL = 'claude-haiku-4-5-20251001';
const CACHE_TTL_SECONDS = 2 * 24 * 60 * 60;
const LOCK_TTL_MS = 60_000;
const LOCK_WAIT_MS = 45_000;
const RATE_LIMIT_PER_MINUTE = 10;
const FACTS_WORK_SUMMARY_MAX_CHARS = 4000;

export class CustomRangeError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

export interface RangeWindow {
    startDate: string;
    endDate: string;
}

export interface RangeTicket {
    key: string;
    issueType: string;
    status: string;
    description: string;
    asOf: string;
}

export interface RangeBlocker {
    key: string;
    summary: string;
    status: string;
    assignee: string;
    blockedSince: string | null;
}

export type AchievementsSource = 'ai' | 'fallback' | 'none';

export interface CustomRangeReport {
    project: { id: number; code: string; name: string };
    window: RangeWindow;
    calendarDays: number;
    snapshotCount: number;
    missingDates: string[];
    health: {
        status: string;
        avg: number;
        scoredDays: number;
        counts: { Red: number; Amber: number; Green: number; Unknown: number };
    };
    healthTimeline: Array<{ date: string; health: string | null }>;
    achievements: { text: string; source: AchievementsSource };
    blockers: RangeBlocker[];
    risks: { text: string; asOf: string | null };
    tickets: RangeTicket[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toUtcMs = (d: string): number => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, day);
};

const isRealDate = (d: string): boolean => {
    if (!DATE_RE.test(d)) return false;
    return new Date(toUtcMs(d)).toISOString().slice(0, 10) === d;
};

export function validateWindow(startDate: unknown, endDate: unknown, today: string = istDateStr()): RangeWindow {
    if (typeof startDate !== 'string' || typeof endDate !== 'string' || !isRealDate(startDate) || !isRealDate(endDate)) {
        throw new CustomRangeError(400, 'startDate and endDate are required in YYYY-MM-DD format');
    }
    if (startDate > endDate) {
        throw new CustomRangeError(400, 'startDate must not be after endDate');
    }
    if (startDate > today) {
        throw new CustomRangeError(400, 'startDate cannot be in the future');
    }
    if (endDate > today) {
        throw new CustomRangeError(400, 'endDate cannot be in the future');
    }
    const days = Math.round((toUtcMs(endDate) - toUtcMs(startDate)) / 86_400_000) + 1;
    if (days > MAX_RANGE_DAYS) {
        throw new CustomRangeError(
            400,
            `The selected range is ${days} days. Pick a window of ${MAX_RANGE_DAYS} calendar days or fewer.`
        );
    }
    return { startDate, endDate };
}

function listDates(w: RangeWindow): string[] {
    const out: string[] = [];
    for (let t = toUtcMs(w.startDate); t <= toUtcMs(w.endDate); t += 86_400_000) {
        out.push(new Date(t).toISOString().slice(0, 10));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Deterministic reducer
// ---------------------------------------------------------------------------

const keyOrder = (a: string, b: string): number => {
    const pa = a.match(/^(.*?)-(\d+)$/);
    const pb = b.match(/^(.*?)-(\d+)$/);
    if (pa && pb) {
        if (pa[1] !== pb[1]) return pa[1] < pb[1] ? -1 : 1;
        return Number(pa[2]) - Number(pb[2]);
    }
    return a < b ? -1 : a > b ? 1 : 0;
};

const str = (v: unknown): string => (v == null ? '' : String(v));


const TICKET_LINE_RE = /^[\s*\-\u2022]*([A-Z][A-Z0-9]*-\d+)\s*:?\s*(?:\[([^\]]*)\]\s*)?[-\u2013]?\s*(.*)$/;
const TYPE_PREFIX_RE = /^(Story|Sub-bug|Sub-task|Bug|Task|Epic|Spike|Improvement)\b\s*[-\u2013:]?\s*/i;

/**
 * Ticket entries of one daily snapshot. Prefers the structured array; most snapshots
 * predate it (it is only filled on newer generations), so otherwise the per-ticket lines of
 * the daily ticketDetails text are parsed and each ticket's status is read from ticketKeys
 * (key -> Jira status on that day). Keys that are not in ticketKeys are still listed, with
 * an empty status, because the daily report itself lists them.
 */
function ticketsOfSnapshot(s: any): Array<{ key: string; issueType: string; status: string; description: string }> {
    const structured = Array.isArray(s.ticketDetailsStructured) ? s.ticketDetailsStructured : [];
    if (structured.length > 0) {
        return structured
            .filter((t: any) => t && t.key)
            .map((t: any) => ({ key: String(t.key), issueType: str(t.issueType), status: str(t.status), description: str(t.description) }));
    }
    const text = str(s.ticketDetails);
    if (!text) return [];
    const statusByKey: Record<string, string> =
        s.ticketKeys && typeof s.ticketKeys === 'object' && !Array.isArray(s.ticketKeys) ? s.ticketKeys : {};
    const out: Array<{ key: string; issueType: string; status: string; description: string }> = [];
    for (const line of text.split('\n').map(l => l.trim()).filter(Boolean)) {
        const m = line.match(TICKET_LINE_RE);
        if (!m) continue;
        let issueType = m[2] || '';
        let description = (m[3] || '').trim();
        if (!issueType) {
            const tm = description.match(TYPE_PREFIX_RE);
            if (tm) { issueType = tm[1]; description = description.slice(tm[0].length).trim(); }
        }
        out.push({ key: m[1], issueType, status: str(statusByKey[m[1]]), description });
    }
    return out;
}

interface Reduced {
    snapshotCount: number;
    missingDates: string[];
    healthTimeline: Array<{ date: string; health: string | null }>;
    health: CustomRangeReport['health'];
    tickets: RangeTicket[];
    blockers: RangeBlocker[];
    risks: { text: string; asOf: string | null };
    latestWorkSummary: string;
    latestExecutiveSummary: string;
}

export function reduceSnapshots(snapshots: any[], window: RangeWindow): Reduced {
    const ordered = [...snapshots].sort((a, b) => (str(a.date) < str(b.date) ? -1 : str(a.date) > str(b.date) ? 1 : 0));
    const present = new Set(ordered.map(s => str(s.date)));
    const missingDates = listDates(window).filter(d => !present.has(d));

    const confirmedProdBugKeys = [
        ...new Set(ordered.flatMap(s => (Array.isArray(s.confirmedProdBugKeys) ? s.confirmedProdBugKeys : []) as string[])),
    ];
    const scrub = (t: string) => aiService.scrubText(t, confirmedProdBugKeys);

    const healthTimeline = ordered.map(s => ({ date: str(s.date), health: (s.overallHealth as string) || null }));
    const rollup = rollupHealth(healthTimeline.map(h => h.health));

    // Latest-dated entry per ticket key wins, so progression between dates is dropped.
    const byKey = new Map<string, RangeTicket>();
    for (const s of ordered) {
        for (const t of ticketsOfSnapshot(s)) {
            byKey.set(t.key, {
                key: t.key,
                issueType: t.issueType,
                status: t.status,
                description: scrub(t.description),
                asOf: str(s.date),
            });
        }
    }
    const tickets = [...byKey.values()].sort((a, b) => keyOrder(a.key, b.key));

    // Blockers: only what is still blocked on the last snapshot in the range.
    const last = ordered[ordered.length - 1];
    const blockers: RangeBlocker[] = [];
    if (last && Array.isArray(last.blockedTickets)) {
        const lastBlocked = last.blockedTickets as any[];
        for (const b of lastBlocked) {
            if (!b || !b.key) continue;
            let since: string | null = b.blockedSince ? str(b.blockedSince).slice(0, 10) : null;
            if (!since) {
                // Start of the unbroken run of snapshots in which this key is blocked, ending at the last one.
                for (let i = ordered.length - 1; i >= 0; i--) {
                    const list = Array.isArray(ordered[i].blockedTickets) ? (ordered[i].blockedTickets as any[]) : [];
                    if (!list.some(x => x && x.key === b.key)) break;
                    since = str(ordered[i].date);
                }
            }
            blockers.push({
                key: String(b.key),
                summary: scrub(str(b.summary)),
                status: str(b.status),
                assignee: str(b.assignee),
                blockedSince: since,
            });
        }
        blockers.sort((a, b) => keyOrder(a.key, b.key));
    }

    const risks = last
        ? { text: scrub(str(last.executiveRisks)).trim(), asOf: str(last.date) }
        : { text: '', asOf: null };

    return {
        snapshotCount: ordered.length,
        missingDates,
        healthTimeline,
        health: {
            status: rollup.health,
            avg: Math.round(rollup.avg * 100) / 100,
            scoredDays: rollup.scorableCount,
            counts: rollup.counts,
        },
        tickets,
        blockers,
        risks,
        latestWorkSummary: last ? scrub(str(last.workSummary)).trim() : '',
        latestExecutiveSummary: last ? scrub(str(last.executiveSummary)).trim() : '',
    };
}

// ---------------------------------------------------------------------------
// Achievements: AI narrative with Redis cache, single-flight and rate limit
// ---------------------------------------------------------------------------

let redisClient: Redis | null = null;
const getRedis = (): Redis | null => {
    try {
        if (!redisClient) {
            redisClient = new Redis({
                host: config.redis.host,
                port: config.redis.port,
                maxRetriesPerRequest: 1,
                enableOfflineQueue: false,
            });
            redisClient.on('error', () => { /* handled per call; cache is best-effort */ });
        }
        return redisClient;
    } catch {
        return null;
    }
};

const inflight = new Map<string, Promise<string | null>>();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const TICKET_KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/g;

function buildFacts(reduced: Reduced): { json: string; keys: Set<string> } {
    const facts = {
        tickets: reduced.tickets.map(t => ({
            key: t.key,
            type: t.issueType,
            status: t.status,
            description: t.description,
        })),
        latestDailyWorkSummary: reduced.latestWorkSummary.slice(0, FACTS_WORK_SUMMARY_MAX_CHARS),
    };
    return { json: JSON.stringify(facts), keys: new Set(reduced.tickets.map(t => t.key)) };
}

function deterministicFallback(reduced: Reduced): string {
    return reduced.latestWorkSummary || reduced.latestExecutiveSummary || '';
}

function validNarrative(text: string, allowedKeys: Set<string>, scrub: (t: string) => string): string | null {
    const cleaned = scrub(text).trim();
    if (!cleaned) return null;
    const found = cleaned.match(TICKET_KEY_RE) || [];
    if (found.some(k => !allowedKeys.has(k))) return null;
    return cleaned;
}

async function composeWithAi(factsJson: string, allowedKeys: Set<string>, scrub: (t: string) => string): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const raw = await aiService.composeRangeAchievements(factsJson);
            const ok = validNarrative(raw, allowedKeys, scrub);
            if (ok) return ok;
            logger.warn('Custom range achievements failed validation, retrying', 'CustomRangeReport');
        } catch (err: any) {
            logger.warn(`Custom range achievements AI call failed: ${err?.message || err}`, 'CustomRangeReport');
        }
    }
    return null;
}

async function resolveAchievements(
    reduced: Reduced,
    userId: number | undefined,
    scrub: (t: string) => string
): Promise<{ text: string; source: AchievementsSource }> {
    const fallbackText = deterministicFallback(reduced);
    if (reduced.tickets.length === 0 && !reduced.latestWorkSummary) {
        return { text: fallbackText, source: fallbackText ? 'fallback' : 'none' };
    }

    const { json, keys } = buildFacts(reduced);
    const hash = createHash('sha256').update(`${PROMPT_VERSION}|${AI_MODEL}|${json}`).digest('hex');
    const cacheKey = `custom-range:ach:${hash}`;
    const lockKey = `custom-range:lock:${hash}`;
    const redis = getRedis();

    const readCache = async (): Promise<string | null> => {
        if (!redis) return null;
        try { return await redis.get(cacheKey); } catch { return null; }
    };

    const cached = await readCache();
    if (cached) return { text: cached, source: 'ai' };

    // Another request in this process is already composing the same input.
    const existing = inflight.get(cacheKey);
    if (existing) {
        const text = await existing;
        return text ? { text, source: 'ai' } : { text: fallbackText, source: 'fallback' };
    }

    const work = (async (): Promise<string | null> => {
        let haveLock = !redis; // without Redis there is nothing to coordinate on
        if (redis) {
            try {
                haveLock = (await redis.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX')) === 'OK';
            } catch { haveLock = true; }
        }
        if (!haveLock) {
            // Another server instance holds the lock: wait for its result rather than spending tokens.
            const deadline = Date.now() + LOCK_WAIT_MS;
            while (Date.now() < deadline) {
                await sleep(1000);
                const c = await readCache();
                if (c) return c;
            }
            return null;
        }
        try {
            if (redis && userId != null) {
                try {
                    const rlKey = `custom-range:rl:${userId}:${Math.floor(Date.now() / 60_000)}`;
                    const n = await redis.incr(rlKey);
                    if (n === 1) await redis.expire(rlKey, 90);
                    if (n > RATE_LIMIT_PER_MINUTE) {
                        logger.warn(`Custom range AI rate limit hit for user ${userId}`, 'CustomRangeReport');
                        return null;
                    }
                } catch { /* rate limiting is best-effort */ }
            }
            const text = await composeWithAi(json, keys, scrub);
            if (text && redis) {
                try { await redis.set(cacheKey, text, 'EX', CACHE_TTL_SECONDS); } catch { /* best-effort */ }
            }
            return text;
        } finally {
            if (redis) { try { await redis.del(lockKey); } catch { /* ignore */ } }
        }
    })();

    inflight.set(cacheKey, work);
    try {
        const text = await work;
        return text ? { text, source: 'ai' } : { text: fallbackText, source: fallbackText ? 'fallback' : 'none' };
    } finally {
        inflight.delete(cacheKey);
    }
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export async function buildCustomRangeReport(
    project: Project,
    window: RangeWindow,
    userId?: number
): Promise<CustomRangeReport> {
    const snapshots = await DailyBoardSnapshot.findAll({
        where: {
            projectId: project.id,
            date: { [Op.between]: [window.startDate, window.endDate] },
        },
        order: [['date', 'ASC']],
    });

    const reduced = reduceSnapshots(snapshots as any[], window);
    const confirmedProdBugKeys = [
        ...new Set(snapshots.flatMap(s => ((s.confirmedProdBugKeys as string[] | null) ?? []))),
    ];
    const scrub = (t: string) => aiService.scrubText(t, confirmedProdBugKeys);

    const achievements = reduced.snapshotCount === 0
        ? { text: '', source: 'none' as AchievementsSource }
        : await resolveAchievements(reduced, userId, scrub);

    return {
        project: { id: project.id, code: project.code, name: project.name },
        window,
        calendarDays: listDates(window).length,
        snapshotCount: reduced.snapshotCount,
        missingDates: reduced.missingDates,
        health: reduced.health,
        healthTimeline: reduced.healthTimeline,
        achievements,
        blockers: reduced.blockers,
        risks: reduced.risks,
        tickets: reduced.tickets,
    };
}

// ---------------------------------------------------------------------------
// Rendering: .txt and .eml
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d: string): string => {
    const [y, m, day] = d.split('-').map(Number);
    return `${day} ${MONTHS[m - 1]} ${y}`;
};
const fmtShort = (d: string): string => {
    const [, m, day] = d.split('-').map(Number);
    return `${day} ${MONTHS[m - 1]}`;
};

export const reportTitle = (r: CustomRangeReport): string =>
    `Project Progress Report: ${r.project.name}, ${fmtShort(r.window.startDate)} to ${fmtDate(r.window.endDate)}`;

export const reportFileBase = (r: CustomRangeReport): string =>
    `${r.project.code || r.project.name}_progress_${r.window.startDate}_to_${r.window.endDate}`.replace(/[^A-Za-z0-9._-]+/g, '-');

const healthLine = (r: CustomRangeReport): string => {
    const c = r.health.counts;
    return `${r.health.status} (avg ${r.health.avg.toFixed(2)} across ${r.health.scoredDays} scored day${r.health.scoredDays === 1 ? '' : 's'}: ` +
        `${c.Green} Green, ${c.Amber} Amber, ${c.Red} Red)`;
};

const achievementsNote = (r: CustomRangeReport): string =>
    r.achievements.source === 'fallback'
        ? 'Note: compiled from the latest daily summary without AI composition.'
        : '';

const missingNote = (r: CustomRangeReport): string =>
    r.missingDates.length > 0
        ? `No daily report exists for: ${r.missingDates.map(fmtShort).join(', ')}. Anything that happened only on those days is not reflected.`
        : '';

export function renderText(r: CustomRangeReport): string {
    const sep = '='.repeat(80);
    const sub = '-'.repeat(80);
    const out: string[] = [];
    out.push(sep, `                    ${reportTitle(r).toUpperCase()}`, sep, '');
    out.push(`Project: ${r.project.name}`);
    out.push(`Range: ${fmtDate(r.window.startDate)} to ${fmtDate(r.window.endDate)} (${r.calendarDays} calendar days, ${r.snapshotCount} daily reports)`);
    out.push(`Health: ${r.snapshotCount > 0 ? healthLine(r) : 'Unknown'}`);
    if (missingNote(r)) out.push(missingNote(r));
    out.push('', sep, '', 'ACHIEVEMENTS', sub, '');
    out.push(r.achievements.text ? r.achievements.text.replace(/^## ?/gm, '') : 'No achievements recorded for this range.');
    if (achievementsNote(r)) out.push('', achievementsNote(r));
    out.push('', sep, '', 'BLOCKERS AND RISKS', sub, '');
    out.push('Still blocked at end of range:');
    if (r.blockers.length === 0) out.push('  None.');
    for (const b of r.blockers) {
        out.push(`  - ${b.key}: ${b.summary} [${b.status}]${b.assignee ? ` - ${b.assignee}` : ''}${b.blockedSince ? ` - since ${fmtShort(b.blockedSince)}` : ''}`);
    }
    out.push('', `Risks${r.risks.asOf ? ` (latest daily report, ${fmtDate(r.risks.asOf)})` : ''}:`);
    out.push(r.risks.text || '  None reported.');
    out.push('', sep, '');
    return out.join('\n');
}

export function renderEml(r: CustomRangeReport, fromAddress: string): string {
    const base = 'font-family:Calibri,sans-serif;font-size:11pt;color:#212121';
    const h = 'font-family:Calibri,sans-serif;font-size:12pt;color:black';
    const statusColor: Record<string, string> = { Green: '#4caf50', Amber: '#ff9800', Red: '#f44336' };
    const para = (t: string) => escapeHtml(t).replace(/\n/g, '<br>');
    const li = (t: string) => `<li style="${base}">${t}</li>\n`;

    const achievementsHtml = r.achievements.text
        ? r.achievements.text.split(/\n+/).map(line => {
            const m = line.match(/^##\s*(.*)$/);
            return m
                ? `<p style="${base};margin-bottom:2px"><b>${escapeHtml(m[1])}</b></p>\n`
                : `<p style="${base};margin-top:0">${para(line)}</p>\n`;
        }).join('')
        : `<p style="${base}">No achievements recorded for this range.</p>\n`;

    const blockersHtml = r.blockers.length === 0
        ? `<p style="${base}">None.</p>\n`
        : '<ul>\n' + r.blockers.map(b =>
            li(`<b>${escapeHtml(b.key)}</b>: ${escapeHtml(b.summary)} [${escapeHtml(b.status)}]` +
                (b.assignee ? ` - ${escapeHtml(b.assignee)}` : '') +
                (b.blockedSince ? ` - since ${escapeHtml(fmtShort(b.blockedSince))}` : ''))
        ).join('') + '</ul>\n';

    const color = statusColor[r.health.status] || '#666666';
    const notes = [achievementsNote(r), missingNote(r)].filter(Boolean)
        .map(n => `<p style="${base};color:#666666"><i>${escapeHtml(n)}</i></p>\n`).join('');

    const html = '<html>\n<body style="word-wrap:break-word">\n<div>\n'
        + `<p style="${base}">Hi All,</p>\n`
        + `<p style="${base}">Please find the progress report for <b>${escapeHtml(r.project.name)}</b> from ${escapeHtml(fmtDate(r.window.startDate))} to ${escapeHtml(fmtDate(r.window.endDate))}.</p>\n`
        + `<p style="${base}"><b>Status:</b> <u style="color:${color}">${escapeHtml(r.snapshotCount > 0 ? r.health.status : 'Unknown')}</u></p>\n`
        + notes
        + `<p style="${h}"><b>Achievements</b></p>\n${achievementsHtml}`
        + `<p style="${h}"><b>Blockers and Risks</b></p>\n`
        + `<p style="${base};margin-bottom:2px"><b>Still blocked at end of range</b></p>\n${blockersHtml}`
        + `<p style="${base};margin-bottom:2px"><b>Risks</b></p>\n`
        + `<p style="${base};margin-top:0">${r.risks.text ? para(r.risks.text) : 'None reported.'}</p>\n`
        + `<p style="${base}">Thanks &amp; Regards</p>\n`
        + '</div>\n</body>\n</html>';

    const subject = reportTitle(r);
    const encodedSubject = /^[\x20-\x7e]*$/.test(subject)
        ? subject
        : `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
    return buildEmlContent(fromAddress || 'draft@localhost', '', '', encodedSubject, html);
}
