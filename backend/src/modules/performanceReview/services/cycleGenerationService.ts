import { Op } from 'sequelize';
import { ReviewCycleConfig, ReviewCadence } from '../../../models/ReviewCycleConfig';
import { ReviewCycle } from '../../../models/ReviewCycle';
import { Project } from '../../../models/Project';

/**
 * Review period generation.
 *
 * All arithmetic is on plain YYYY-MM-DD strings in UTC-safe form. The codebase has
 * no date library, and Date-based month arithmetic silently shifts across a
 * timezone boundary — a cycle boundary that moves by a day would reassign sprints
 * between review periods, which changes people's scores.
 */

export interface GeneratedPeriod {
    periodLabel: string;
    startDate: string;
    endDate: string;
    reviewYear: string;
    sequenceNo: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

const toKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function parse(date: string): { y: number; m: number; d: number } {
    const [y, m, d] = date.split('-').map(Number);
    return { y, m, d };
}

function daysInMonth(y: number, m: number): number {
    // Day 0 of the next month is the last day of this one.
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Add whole months, clamping the day to the target month's length. */
function addMonths(date: string, months: number): string {
    const { y, m, d } = parse(date);
    const total = (y * 12 + (m - 1)) + months;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    return toKey(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

function addDays(date: string, days: number): string {
    const { y, m, d } = parse(date);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return toKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

const lte = (a: string, b: string) => a <= b;

const MONTHS_PER_CYCLE: Record<ReviewCadence, number> = { monthly: 1, quarterly: 3 };

/**
 * The review year a period belongs to, by its START date.
 *
 * With `startMonth = 4` (April, the Indian FY), Oct 2026 is 'FY2026-27' and
 * Feb 2027 is still 'FY2026-27'. Using the start date rather than the end keeps a
 * period that straddles the year boundary in one place.
 */
export function reviewYearOf(date: string, startMonth: number): string {
    const { y, m } = parse(date);
    if (startMonth === 1) return `FY${y}`;
    const firstYear = m >= startMonth ? y : y - 1;
    return `FY${firstYear}-${String((firstYear + 1) % 100).padStart(2, '0')}`;
}

/** First day of the review year containing `date`. */
export function reviewYearStart(date: string, startMonth: number): string {
    const { y, m } = parse(date);
    const firstYear = m >= startMonth ? y : y - 1;
    return toKey(firstYear, startMonth, 1);
}

function labelFor(cadence: ReviewCadence, start: string, reviewYear: string, seq: number): string {
    if (cadence === 'monthly') {
        const { y, m } = parse(start);
        return `${y}-${pad(m)}`;
    }
    return `${reviewYear.replace(/^FY\d{2}/, 'FY')}-Q${seq}`;
}

/**
 * Generate every period from `from` to `to`.
 *
 * Periods are anchored on the config's `anchorDate` day-of-month and stride by
 * cadence, so an anchor of the 15th produces 15th-to-14th periods. Boundaries are
 * walked backwards from the anchor to cover `from`, so backfilling history
 * produces exactly the same boundaries as going forwards — a cycle's dates must
 * not depend on when it was generated.
 *
 * Pure: no DB access, so the config screen can preview it without writing.
 */
export function generatePeriods(
    config: Pick<ReviewCycleConfig, 'cadence' | 'anchorDate' | 'reviewYearStartMonth'>,
    from: string,
    to: string,
): GeneratedPeriod[] {
    const stride = MONTHS_PER_CYCLE[config.cadence];
    const startMonth = config.reviewYearStartMonth;
    const anchor = String(config.anchorDate).slice(0, 10);

    // Every boundary is computed as anchor + k·stride months, never by stepping
    // from the previous boundary. Stepping compounds the short-month clamp: a
    // 31st anchor becomes the 28th at February and then stays there, silently
    // shifting every later cycle and reassigning sprints between periods.
    const boundary = (k: number) => addMonths(anchor, k * stride);

    // Land k on the period containing `from`, starting from an estimate that is
    // guaranteed to be at or before it.
    const a = parse(anchor);
    const f = parse(from);
    const monthDiff = (f.y * 12 + f.m) - (a.y * 12 + a.m);
    let k = Math.floor(monthDiff / stride) - 1;
    while (lte(boundary(k + 1), from)) k += 1;

    const periods: GeneratedPeriod[] = [];
    const seqByYear = new Map<string, number>();

    let cursor = boundary(k);
    while (lte(cursor, to)) {
        const next = boundary(k + 1);
        const end = addDays(next, -1);

        // A period is only in range once it actually overlaps [from, to].
        if (end >= from) {
            const reviewYear = reviewYearOf(cursor, startMonth);
            const seq = (seqByYear.get(reviewYear) ?? 0) + 1;
            seqByYear.set(reviewYear, seq);

            periods.push({
                periodLabel: labelFor(config.cadence, cursor, reviewYear, seq),
                startDate: cursor,
                endDate: end,
                reviewYear,
                sequenceNo: seq,
            });
        }
        k += 1;
        cursor = next;
    }

    return periods;
}

/**
 * Preview what `generate` would create, without writing. Marks which periods
 * already exist so the admin screen can show additions rather than a flat list.
 */
export async function previewCycles(
    accountId: number,
    from: string,
    to: string,
): Promise<Array<GeneratedPeriod & { exists: boolean; status?: string }>> {
    const config = await ReviewCycleConfig.findOne({ where: { accountId } });
    if (!config) throw new Error(`No review configuration for account ${accountId}`);

    const periods = generatePeriods(config, from, to);
    const existing = await ReviewCycle.findAll({
        where: { accountId, startDate: { [Op.in]: periods.map(p => p.startDate) } },
        attributes: ['startDate', 'endDate', 'status'],
    });
    const byStart = new Map(existing.map(c => [String(c.startDate).slice(0, 10), c]));

    return periods.map(p => {
        const match = byStart.get(p.startDate);
        return { ...p, exists: !!match, status: match?.status };
    });
}

/**
 * Materialise cycles for an account.
 *
 * Idempotent on `(account_id, start_date, end_date)`: re-running never duplicates
 * a period. Existing cycles are left completely untouched — in particular their
 * snapshotted weights and scope are never rewritten, because a published score
 * must not change when config is edited later.
 */
export async function generateCycles(
    accountId: number,
    upTo: string,
    from?: string,
): Promise<{ created: number; skipped: number; periods: GeneratedPeriod[] }> {
    const config = await ReviewCycleConfig.findOne({ where: { accountId } });
    if (!config) throw new Error(`No review configuration for account ${accountId}`);

    // Forward-only by default: an account with a `setupDate` (set once, at
    // config creation — see the model) only ever backfills from the month it
    // actually started using Performance Review, not the whole fiscal year.
    // Launching in October under an April fiscal year should show ~5 forward
    // periods, not silently manufacture six pre-setup months nobody can
    // realistically review. Accounts with no `setupDate` (set up before this
    // column existed) keep the original fiscal-year backfill, unaffected.
    const anchor = String(config.anchorDate).slice(0, 10);
    const start = from ?? (config as any).setupDate ?? reviewYearStart(anchor, config.reviewYearStartMonth);

    const periods = generatePeriods(config, start, upTo);

    const existing = await ReviewCycle.findAll({
        where: { accountId },
        attributes: ['startDate'],
    });
    const existingStarts = new Set(existing.map(c => String(c.startDate).slice(0, 10)));

    let created = 0;
    let skipped = 0;

    for (const p of periods) {
        if (existingStarts.has(p.startDate)) {
            skipped += 1;
            continue;
        }
        await ReviewCycle.create({
            accountId,
            configId: config.id,
            periodLabel: p.periodLabel,
            startDate: p.startDate,
            endDate: p.endDate,
            reviewYear: p.reviewYear,
            sequenceNo: p.sequenceNo,
            status: 'scheduled',
            // Snapshot config as it stands now. Never refreshed afterwards.
            weightSystem: config.weightSystem,
            weightLead: config.weightLead,
            weightCustomer: config.weightCustomer,
            leadTemplateId: config.leadTemplateId,
            scopeProjectIds: config.scopeProjectIds ?? [],
        });
        created += 1;
    }

    return { created, skipped, periods };
}

/**
 * A superuser-created period covering several skipped pre-setup months at
 * once — one lead review for the whole span, scored from the combined ticket
 * data across it. Deliberately NOT built on `generatePeriods`'s cadence walk:
 * that function only ever produces cadence-width periods, and a wide,
 * one-off span needs a hand-assigned label and a `sequenceNo` outside the
 * normal per-year trend sequence (reserved as 0) so it never gets mistaken
 * for one of several genuine cadence periods in a member's history.
 *
 * Opening it runs through the exact same pipeline as any other cycle
 * (`openCycle` → `attachSources` → `freezeParticipants` → scoring) — source
 * attachment and aggregation already operate on whatever window they're
 * given, so this needs no scoring-engine change at all.
 */
export async function generateCatchUpCycle(
    accountId: number,
    startDate: string,
    endDate: string,
): Promise<ReviewCycle> {
    const config = await ReviewCycleConfig.findOne({ where: { accountId } });
    if (!config) throw new Error(`No review configuration for account ${accountId}`);
    if (startDate >= endDate) throw new Error('startDate must be before endDate');

    const overlapping = await ReviewCycle.findOne({
        where: {
            accountId,
            startDate: { [Op.lte]: endDate },
            endDate: { [Op.gte]: startDate },
        },
    });
    if (overlapping) {
        throw new Error(
            `Catch-up window overlaps an existing period (${overlapping.periodLabel}, ${overlapping.startDate} → ${overlapping.endDate})`,
        );
    }

    const reviewYear = reviewYearOf(startDate, config.reviewYearStartMonth);
    return ReviewCycle.create({
        accountId,
        configId: config.id,
        periodLabel: `Catch-up: ${startDate} to ${endDate}`,
        startDate,
        endDate,
        reviewYear,
        // Reserved, outside the normal 1..N trend sequence for the review
        // year — a catch-up period is never part of the period-over-period
        // trend comparison.
        sequenceNo: 0,
        status: 'scheduled',
        weightSystem: config.weightSystem,
        weightLead: config.weightLead,
        weightCustomer: config.weightCustomer,
        leadTemplateId: config.leadTemplateId,
        scopeProjectIds: config.scopeProjectIds ?? [],
        isCatchUp: true,
    } as any);
}

/**
 * The projects a cycle draws from: its snapshotted scope, or every project in the
 * account when the scope is empty.
 */
export async function resolveScopeProjectIds(cycle: ReviewCycle): Promise<number[]> {
    if (cycle.scopeProjectIds?.length) return cycle.scopeProjectIds;
    const projects = await Project.findAll({
        where: { accountId: cycle.accountId },
        attributes: ['id'],
    });
    return projects.map(p => p.id);
}
