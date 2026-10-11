/**
 * Detecting agreed points that keep coming back.
 *
 * The single most useful thing a retro tool can tell a lead is "you have agreed
 * this three retros running and never actioned it". That needs grouping by
 * meaning, not by exact string, because people rephrase.
 *
 * Deliberately deterministic token similarity rather than an AI call: this
 * drives a list view, so it must be fast, free, and — most importantly — stable.
 * A clustering that shifts between two renders of the same data would make the
 * repeat badges untrustworthy. The whole module is pure and model-free (same
 * rationale as retroPermissions.ts and voteBudget.ts) so it unit-tests without a
 * database.
 *
 * If this proves too blunt in real use, the seam is exactly one function and an
 * AI-backed implementation can replace it without touching callers.
 */

export type RepeatStrength = 'EXACT_REPEAT' | 'LIKELY_REPEAT' | 'DISTINCT';

/** At or above this Jaccard score, two points are the same point reworded. */
export const EXACT_THRESHOLD = 0.8;
/** At or above this, they are probably the same theme. */
export const LIKELY_THRESHOLD = 0.5;

/**
 * Words carrying no signal for retro phrasing. Kept deliberately short — an
 * aggressive stopword list starts merging genuinely different points ("deploy
 * to staging" vs "deploy to production" differ only in a word you might be
 * tempted to strip).
 */
const STOPWORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
    'to', 'of', 'in', 'on', 'at', 'for', 'with', 'we', 'our', 'us', 'i', 'it', 'its',
    'this', 'that', 'these', 'those', 'as', 'by', 'from', 'too', 'so', 'very', 'more',
    'need', 'needs', 'should', 'must', 'can', 'could', 'would', 'will', 'do', 'does',
]);

export function tokenise(text: string): Set<string> {
    const tokens = String(text ?? '')
        .toLowerCase()
        // Hyphens JOIN rather than split: "stand-ups" and "standups" are the
        // same word, and splitting would leave them sharing no tokens at all.
        // Same for "follow-up" / "followup", "re-open" / "reopen".
        .replace(/-/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1 && !STOPWORDS.has(t))
        // Crude plural folding so "standups" and "standup" match. Not a real
        // stemmer; enough for short retro phrasing and it cannot merge
        // unrelated words the way aggressive stemming can.
        .map(t => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));

    return new Set(tokens);
}

export function similarity(a: string, b: string): number {
    const ta = tokenise(a);
    const tb = tokenise(b);
    if (ta.size === 0 || tb.size === 0) return 0;

    let shared = 0;
    for (const t of ta) if (tb.has(t)) shared++;

    const union = ta.size + tb.size - shared;
    const jaccard = union === 0 ? 0 : shared / union;

    // Containment, blended with Jaccard.
    //
    // Jaccard alone punishes length differences, which is exactly the wrong
    // behaviour here: "Standups overrun" and "standups overrun every single day"
    // are plainly the same point, but score only 0.4 because the second is
    // wordier. Containment (shared ÷ smaller set) recognises a short point
    // restated inside a longer one.
    //
    // Guarded by shared >= 2 so a single common word cannot merge unrelated
    // points — without it, "flaky tests" and "tests are slow" would collapse
    // together on the word "test" alone.
    const minSize = Math.min(ta.size, tb.size);
    const containment = shared >= 2 ? shared / minSize : 0;

    return Math.max(jaccard, containment);
}

export function classify(a: string, b: string): RepeatStrength {
    const score = similarity(a, b);
    if (score >= EXACT_THRESHOLD) return 'EXACT_REPEAT';
    if (score >= LIKELY_THRESHOLD) return 'LIKELY_REPEAT';
    return 'DISTINCT';
}

export interface AgreedPointInput {
    itemId: number;
    boardId: number;
    boardTitle: string;
    meetingDate: string;
    content: string;
    topPickRank: number | null;
    outcome: string | null;
    convertedType: string | null;
    convertedRefId: number | null;
}

export interface AgreedTheme {
    /** Representative wording — the earliest occurrence, so the theme reads as it was first raised. */
    label: string;
    occurrences: AgreedPointInput[];
    /** Strongest relationship found within the group. */
    strength: RepeatStrength;
    /** True when raised in more than one retro — the thing worth a badge. */
    isRepeat: boolean;
    /** Raised repeatedly and never resolved. The case a lead most needs to see. */
    unresolvedRepeat: boolean;
}

/**
 * Group agreed points into themes.
 *
 * Greedy single-pass clustering: each point joins the first existing theme it
 * is similar enough to, otherwise starts its own. Order-dependent in principle,
 * but callers pass points in a stable chronological order, so the output is
 * stable too — and a greedy pass avoids the quadratic-merge complexity that a
 * proper clustering would need for no practical gain at this scale (a project
 * accumulates tens of agreed points, not thousands).
 */
export function groupIntoThemes(points: AgreedPointInput[]): AgreedTheme[] {
    const themes: Array<{ label: string; occurrences: AgreedPointInput[]; strength: RepeatStrength }> = [];

    for (const point of points) {
        let placed = false;

        for (const theme of themes) {
            const strength = classify(theme.label, point.content);
            if (strength !== 'DISTINCT') {
                theme.occurrences.push(point);
                // Keep the strongest relationship seen in this theme.
                if (strength === 'EXACT_REPEAT') theme.strength = 'EXACT_REPEAT';
                placed = true;
                break;
            }
        }

        if (!placed) {
            themes.push({ label: point.content, occurrences: [point], strength: 'DISTINCT' });
        }
    }

    return themes
        .map(theme => {
            const boards = new Set(theme.occurrences.map(o => o.boardId));
            const isRepeat = boards.size > 1;
            // "Unresolved" means nobody marked it done and nobody turned it into
            // tracked work. A dropped point is a decision, so it does not count.
            const unresolved = theme.occurrences.every(
                o => o.outcome !== 'DONE' && o.outcome !== 'DROPPED' && !o.convertedType
            );

            return {
                label: theme.label,
                occurrences: theme.occurrences,
                strength: isRepeat ? (theme.strength === 'DISTINCT' ? 'LIKELY_REPEAT' : theme.strength) : 'DISTINCT',
                isRepeat,
                unresolvedRepeat: isRepeat && unresolved,
            } as AgreedTheme;
        })
        // Most-repeated first, then most recent — the lead should see nagging
        // themes before one-offs.
        .sort(
            (a, b) =>
                b.occurrences.length - a.occurrences.length ||
                (b.occurrences[0]?.meetingDate ?? '').localeCompare(a.occurrences[0]?.meetingDate ?? '')
        );
}
