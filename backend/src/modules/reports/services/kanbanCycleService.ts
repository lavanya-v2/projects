/**
 * Deterministic Kanban work-cycle generation.
 *
 * A Kanban project can be configured with a fixed cadence: a window length in
 * days (e.g. 5 or 7), an anchor start date (the start of cycle #0), and how
 * often that window repeats. Every cycle is derived deterministically as the
 * calendar window [start, start + windowDays - 1] (inclusive), with cycle N
 * starting `strideDays` after cycle N-1.
 *
 * Window length and stride are separate because they are separate questions.
 * When stride === window the cycles are back-to-back and every day belongs to
 * exactly one cycle -- the original behaviour, and still the default when no
 * stride is supplied. When stride > window the cycles are weekday-aligned with
 * a gap: window 5 / stride 7 anchored on a Monday gives Mon-Fri every week and
 * leaves the weekend out, which is how a "regroup Monday, target Friday" team
 * actually works. Without the split, a 5-day cadence would walk around the
 * calendar -- Mon-Fri, then Sat-Wed, then Thu-Mon -- because the next cycle
 * would start the day after the previous one ended.
 *
 * Stride shorter than the window would make cycles overlap, so a day could
 * belong to two cycles at once and any per-cycle metric would double-count it.
 * That is rejected as invalid config rather than silently produced.
 *
 * All date math is done in UTC against YYYY-MM-DD strings to avoid any
 * server-timezone / DST drift (DATEONLY semantics).
 */

const MS_PER_DAY = 86_400_000;

export interface KanbanCycle {
    index: number;       // 0-based cycle number from the anchor
    startDate: string;   // YYYY-MM-DD inclusive
    endDate: string;     // YYYY-MM-DD inclusive
    label: string;       // e.g. "Cycle: Jun 2 - Jun 8, 2026"
    isComplete: boolean; // endDate strictly before asOf (cycle fully elapsed)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse a YYYY-MM-DD string into a UTC-midnight epoch millisecond value. */
function toUtcMs(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

/** Format a UTC-midnight epoch millisecond value back to YYYY-MM-DD. */
function toDateStr(ms: number): string {
    const dt = new Date(ms);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Whole-day difference (b - a), both YYYY-MM-DD. */
function diffDays(aStr: string, bStr: string): number {
    return Math.floor((toUtcMs(bStr) - toUtcMs(aStr)) / MS_PER_DAY);
}

/**
 * Validate a proposed (window, stride) pair before it is saved.
 *
 * generateCycles() already refuses an invalid pair, but it does so by quietly
 * returning an empty cycle list -- correct for a read path, wrong for a write
 * path. A project saved with stride < window would show zero cycles
 * everywhere with no indication why. This is the single source of truth for
 * the error message, called from the admin API so the failure surfaces at
 * save time instead of as a silent empty list downstream.
 *
 * strideDays undefined/null is valid (back-to-back, defaults to windowDays).
 */
export function validateKanbanCadence(
    windowDays: number | null | undefined,
    strideDays: number | null | undefined,
): { valid: true } | { valid: false; error: string } {
    if (strideDays === undefined || strideDays === null) return { valid: true };
    if (!windowDays || windowDays <= 0) return { valid: true }; // no window yet; nothing to check the stride against
    if (strideDays <= 0) return { valid: false, error: 'Repeats every (days) must be a positive number' };
    if (strideDays < windowDays) {
        return { valid: false, error: 'Repeats every (days) must be at least the working window, or cycles would overlap' };
    }
    return { valid: true };
}

/**
 * Resolve the effective stride. Absent/null means "back-to-back", i.e. stride
 * equals the window -- the behaviour every existing project was configured
 * under, so omitting it must stay a no-op. Returns null when the config is
 * unusable (non-positive, or shorter than the window, which would overlap
 * cycles and double-count days), letting callers return empty.
 */
function resolveStride(cycleDays: number, strideDays?: number | null): number | null {
    if (strideDays === undefined || strideDays === null) return cycleDays;
    if (strideDays <= 0 || strideDays < cycleDays) return null;
    return strideDays;
}

/** Human label, e.g. "Cycle: Jun 2 - Jun 8, 2026". */
export function cycleLabel(startDate: string, endDate: string): string {
    const s = new Date(toUtcMs(startDate));
    const e = new Date(toUtcMs(endDate));
    const startPart = `${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()}`;
    const endPart = `${MONTHS[e.getUTCMonth()]} ${e.getUTCDate()}`;
    return `Cycle: ${startPart} - ${endPart}, ${e.getUTCFullYear()}`;
}

/**
 * Generate all cycles from the anchor up to (and including) the cycle that
 * contains `asOf`. Returns ascending by index. Empty if config is invalid or
 * the anchor is in the future relative to asOf.
 */
export function generateCycles(
    anchorDate: string,
    cycleDays: number,
    asOf: string,
    strideDays?: number | null,
): KanbanCycle[] {
    const stride = resolveStride(cycleDays, strideDays);
    if (!anchorDate || !cycleDays || cycleDays <= 0 || stride === null) return [];

    const spanDays = diffDays(anchorDate, asOf);
    if (spanDays < 0) return [];

    const lastIndex = Math.floor(spanDays / stride);
    const anchorMs = toUtcMs(anchorDate);
    const asOfMs = toUtcMs(asOf);

    const cycles: KanbanCycle[] = [];
    for (let i = 0; i <= lastIndex; i++) {
        const startMs = anchorMs + i * stride * MS_PER_DAY;
        const endMs = startMs + (cycleDays - 1) * MS_PER_DAY;
        const startDate = toDateStr(startMs);
        const endDate = toDateStr(endMs);
        cycles.push({
            index: i,
            startDate,
            endDate,
            label: cycleLabel(startDate, endDate),
            isComplete: endMs < asOfMs,
        });
    }
    return cycles;
}

/**
 * The single most-recently completed cycle as of `asOf` (endDate strictly
 * before asOf). Returns null if no cycle has completed yet. Used by the
 * scheduler to auto-sync the just-finished cycle.
 */
export function lastCompletedCycle(
    anchorDate: string,
    cycleDays: number,
    asOf: string,
    strideDays?: number | null,
): KanbanCycle | null {
    const completed = generateCycles(anchorDate, cycleDays, asOf, strideDays).filter(c => c.isComplete);
    return completed.length ? completed[completed.length - 1] : null;
}

/** Resolve a single cycle by its index (no DB). Returns null if config invalid. */
export function cycleByIndex(
    anchorDate: string,
    cycleDays: number,
    index: number,
    strideDays?: number | null,
): KanbanCycle | null {
    const stride = resolveStride(cycleDays, strideDays);
    if (!anchorDate || !cycleDays || cycleDays <= 0 || stride === null || index < 0) return null;
    const anchorMs = toUtcMs(anchorDate);
    const startMs = anchorMs + index * stride * MS_PER_DAY;
    const endMs = startMs + (cycleDays - 1) * MS_PER_DAY;
    const startDate = toDateStr(startMs);
    const endDate = toDateStr(endMs);
    return {
        index,
        startDate,
        endDate,
        label: cycleLabel(startDate, endDate),
        isComplete: false, // caller decides; index-resolve doesn't know asOf
    };
}
