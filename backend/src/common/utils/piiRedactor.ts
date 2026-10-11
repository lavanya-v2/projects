// Masks personal data in free text pulled from customer Jira boards.
//
// Ticket titles are persisted verbatim (perf_ticket_facts.summary, snapshot
// JSONB) and form the backbone of the AI prompt, so a title like
// "Call John Doe 555-0123 re: escrow on 42 Oak Street" would otherwise land in
// our database and be sent to a third party. This module masks the structured
// identifiers in such text before it is stored or prompted.
//
// KNOWN CEILING — read before relying on this:
// Regex cannot reliably detect free-floating personal names. The name rules
// below are anchored to honorifics ("Dr. Patel") or trigger words
// ("customer Jane Smith") because a general capitalised-word-pair detector
// would destroy legitimate technical titles like "Payment Gateway" or
// "Prod Bug". A bare name in a title WILL survive redaction. Where a customer's
// tickets routinely embed names, this is not a sufficient control on its own.

export type PiiCategory =
    | 'email'
    | 'phone'
    | 'ssn'
    | 'taxId'
    | 'card'
    | 'account'
    | 'address'
    | 'name';

export interface RedactOptions {
    /** Categories to apply. Defaults to all. */
    categories?: PiiCategory[];
    /** Inputs longer than this are returned untouched. Defaults to 5000. */
    maxLength?: number;
}

export interface RedactionResult {
    text: string;
    changed: boolean;
    hits: Partial<Record<PiiCategory, number>>;
}

// Protected values are swapped for a delimited, LETTERS-ONLY token. Letters
// rather than digits, because a digit-bearing token could itself be matched by
// the year/SSN/card rules and produce nested tokens that the single-pass
// restore could not unwind. The delimiter is a private-use codepoint that
// cannot occur in a Jira title.
const TOKEN_DELIM = '';

function indexToLetters(n: number): string {
    let out = '';
    let value = n;
    do {
        out = String.fromCharCode(65 + (value % 26)) + out;
        value = Math.floor(value / 26);
    } while (value > 0);
    return out;
}

function lettersToIndex(letters: string): number {
    let value = 0;
    for (const ch of letters) value = value * 26 + (ch.charCodeAt(0) - 65);
    return value;
}

/**
 * Patterns tokenized out BEFORE redaction and restored afterwards. These are the
 * false-positive guards: without them the SSN and phone rules eat Jira keys,
 * ISO dates and version strings.
 */
const PROTECTED_PATTERNS: RegExp[] = [
    /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g,                                  // Jira keys: ABC-123
    /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?/g,  // ISO dates/timestamps
    // Versions. Split into a v-prefixed form and a bare form with 1-2 digit
    // segments, so a dotted phone number (415.555.1234 — three-digit segments,
    // no `v`) is NOT protected here and stays available to the phone rule.
    /\bv\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9.]+)?\b/gi,                      // v2.14.3
    /\b\d{1,2}(?:\.\d{1,2}){1,3}(?:-[A-Za-z0-9.]+)?\b/g,                // 1.0.0-rc1
    /\b\d{1,3}(?:\.\d+)?\s*(?:sp|pts?|points?|hrs?|hours?|days?|%)\b/gi, // estimates: 8 SP, 3.5 hrs
    /\b(?:19|20)\d{2}\b/g,                                               // bare years
];

interface Rule {
    category: PiiCategory;
    pattern: RegExp;
    replacement: string | ((...args: any[]) => string);
}

/** Order matters: more specific patterns run before more generic ones. */
const RULES: Rule[] = [
    {
        category: 'email',
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}\b/g,
        replacement: '[email]',
    },
    {
        // Excludes structurally invalid SSNs (000/666/9xx area, 00 group, 0000
        // serial) to cut false positives on arbitrary digit runs.
        category: 'ssn',
        pattern: /\b(?!000|666|9\d\d)\d{3}[-\s](?!00)\d{2}[-\s](?!0000)\d{4}\b/g,
        replacement: '[ssn]',
    },
    {
        category: 'taxId',
        pattern: /\b\d{2}-\d{7}\b/g,
        replacement: '[tax-id]',
    },
    {
        // Luhn-validated below, so ordinary long digit runs are left alone.
        category: 'card',
        // Must both start and END on a digit, otherwise the match swallows the
        // trailing separator and the replacement collides with the next word.
        pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
        replacement: '[card]',
    },
    {
        // Requires a separator between digit groups. A bare 10-digit run is
        // deliberately NOT matched — too many Jira titles carry raw ids.
        category: 'phone',
        pattern: /(?<![\w\-/])(?:\+\d{1,3}[\s.\-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.\-])\d{3}[\s.\-]\d{4}(?![\w\-])/g,
        replacement: '[phone]',
    },
    {
        category: 'phone',
        pattern: /(?<![\w\-/])\+\d{10,14}(?![\w\-])/g,
        replacement: '[phone]',
    },
    {
        // Keyword-anchored AND the captured identifier must contain a digit.
        // Without the digit requirement this destroys ordinary domain prose at a
        // mortgage customer: "Loan Officer" -> "Loan [account-no]",
        // "loan numbers" -> "loan [account-no]", "LoanOfficerSubmissionEvents" ->
        // "Loan [account-no]". Measured at 1644 hits over 20.8k real titles,
        // essentially all false positives. A real account number has digits.
        category: 'account',
        pattern: /\b(account|acct|a\/c|policy|member(?:ship)?|mrn|patient|customer|invoice|order|claim|loan|escrow)\s*(?:no\.?|number|#|id)?\s*[:#]?\s*(?=[A-Za-z0-9-]*\d)([A-Za-z0-9][A-Za-z0-9-]{5,})/gi,
        replacement: (_m: string, kw: string) => `${kw} [account-no]`,
    },
    {
        // Requires the leading house number. This is what disambiguates
        // "Dr" (Drive) from "Dr." (Doctor) and "St" (Street) from "Saint".
        category: 'address',
        pattern: /\b\d{1,6}\s+(?:[A-Za-z0-9.'\-]+\s+){0,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|terrace|ter|place|pl|circle|cir|highway|hwy|parkway|pkwy)\b\.?/gi,
        replacement: '[address]',
    },
    {
        category: 'address',
        // The unit designator must be followed by something containing a DIGIT,
        // and bare "ste"/"apt" now require the period. Previously `ste\.?` matched
        // the "Ste" in "Step 1" and `unit` matched "Unit Test Cases" — 495 hits
        // over 20.8k real titles, all false positives.
        pattern: /\b(?:suite|ste\.|apt\.|apartment|unit|p\.?\s?o\.?\s?box)\s*#?\s*(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{1,8}\b/gi,
        replacement: '[address]',
    },
    {
        category: 'address',
        pattern: /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g,
        replacement: '[address]',
    },
    {
        category: 'name',
        // Explicit case alternation rather than the /i flag: /i would also make
        // the [A-Z][a-z] name part case-insensitive and over-match ordinary words.
        pattern: /\b(?:[Mm]r|[Mm]rs|[Mm]s|[Dd]r|[Pp]rof)\.?\s+[A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?\b/g,
        replacement: '[name]',
    },
    {
        category: 'name',
        // Person-context triggers ONLY. The generic "for|from|by" variant was
        // removed: it fired on ordinary technical phrasing — "for Pricing
        // Exception", "for Transition Needs", "for Lead Creation" — 1096 hits
        // over 20.8k real titles, overwhelmingly false. This trades recall for
        // precision, consistent with the documented ceiling above: free-floating
        // names are NOT reliably caught, and pretending otherwise while mangling
        // real titles is the worse failure.
        pattern: /\b(customer|patient|client|policyholder|borrower|contact|caller)\s+[A-Z][a-z]{1,20}\s+[A-Z][a-z]{1,20}\b/g,
        replacement: (_m: string, kw: string) => `${kw} [name]`,
    },
];

/**
 * Organisations whose names look like people. "Mr. Cooper" is a US mortgage
 * servicer that appears constantly in CCMH ticket titles; the honorific rule
 * reads it as a person and, worse, swallows the following word
 * ("Pass Mr. Cooper Loan Data" -> "Pass [name] Data"). Regex cannot distinguish
 * a brand from a person, so known business entities are listed explicitly.
 * Add to this list as new partner names surface.
 */
const NON_PERSON_ENTITIES: RegExp[] = [
    /\bmr\.?\s+cooper\b/i,
];

const isKnownOrganisation = (match: string) => NON_PERSON_ENTITIES.some(re => re.test(match));

/** Standard Luhn check, used to keep the card rule off ordinary digit runs. */
function luhnValid(digits: string): boolean {
    const clean = digits.replace(/\D/g, '');
    if (clean.length < 13 || clean.length > 19) return false;
    // A run of identical digits sums to a Luhn-valid value surprisingly often —
    // all-zeros always does. Real UUIDs like 00000000-0000-0000-0000-000000000000
    // appear constantly in API ticket titles and were being redacted as cards.
    if (/^(\d)\1*$/.test(clean)) return false;
    let sum = 0;
    let double = false;
    for (let i = clean.length - 1; i >= 0; i--) {
        let d = clean.charCodeAt(i) - 48;
        if (double) {
            d *= 2;
            if (d > 9) d -= 9;
        }
        sum += d;
        double = !double;
    }
    return sum % 10 === 0;
}

/**
 * Mask personal data in `text`.
 *
 * Idempotent: every replacement token ([email], [phone], …) is inert to all
 * rules, so re-running over already-redacted text is a no-op. The retroactive
 * cleanup script (Phase 3) depends on this.
 */
export function redactPii(text: string, opts?: RedactOptions): string {
    return redactPiiDetailed(text, opts).text;
}

export function redactPiiDetailed(text: string, opts?: RedactOptions): RedactionResult {
    const hits: Partial<Record<PiiCategory, number>> = {};
    const maxLength = opts?.maxLength ?? 5000;

    if (typeof text !== 'string' || text.length === 0) {
        return { text: text ?? '', changed: false, hits };
    }
    if (text.length > maxLength) {
        return { text, changed: false, hits };
    }

    const enabled = opts?.categories;
    const isEnabled = (c: PiiCategory) => !enabled || enabled.includes(c);

    // --- Pass A: protect ---------------------------------------------------
    const protectedValues: string[] = [];
    let working = text;
    for (const pattern of PROTECTED_PATTERNS) {
        working = working.replace(new RegExp(pattern.source, pattern.flags), (match) => {
            const token = `${TOKEN_DELIM}${indexToLetters(protectedValues.length)}${TOKEN_DELIM}`;
            protectedValues.push(match);
            return token;
        });
    }

    // --- Pass B: redact ----------------------------------------------------
    for (const rule of RULES) {
        if (!isEnabled(rule.category)) continue;

        working = working.replace(
            new RegExp(rule.pattern.source, rule.pattern.flags),
            (...args: any[]) => {
                const match = args[0] as string;

                // Card matches must pass Luhn, otherwise leave the text alone.
                if (rule.category === 'card' && !luhnValid(match)) return match;

                // Business names that look like people are not PII.
                if (rule.category === 'name' && isKnownOrganisation(match)) return match;

                hits[rule.category] = (hits[rule.category] ?? 0) + 1;
                return typeof rule.replacement === 'function'
                    ? rule.replacement(...args)
                    : rule.replacement;
            },
        );
    }

    // --- Pass C: restore ---------------------------------------------------
    working = working.replace(
        new RegExp(`${TOKEN_DELIM}([A-Z]+)${TOKEN_DELIM}`, 'g'),
        (_m: string, letters: string) => protectedValues[lettersToIndex(letters)] ?? '',
    );

    return { text: working, changed: working !== text, hits };
}

/**
 * The call shape used at ingestion sites: a no-op passthrough when the project
 * has redaction disabled, so callers need no branching of their own.
 */
export function redactIfEnabled(
    text: string | null | undefined,
    enabled: boolean,
    opts?: RedactOptions,
): string {
    const value = text ?? '';
    if (!enabled) return value;
    return redactPii(value, opts);
}
