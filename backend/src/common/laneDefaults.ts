import { config } from '../config';

/**
 * Which Jira fields identify the person in each role, declared per project.
 *
 * Jira instances disagree about what `assignee` MEANS, and the difference is not
 * cosmetic:
 *   - CCM: `assignee` is the developer and never moves to QA; QA lives in a
 *     separate "Assigned QA" field.
 *   - Thrive: `assignee` is a work-queue pointer — whoever holds the ticket right
 *     now — passed Dev -> QA -> Dev. On one 58-issue sprint it changed 150 times
 *     while the static `Developer` field changed 30 and `QA Owner` 11. Reading
 *     `assignee` there attributes a developer's work to whoever is testing it,
 *     and makes the sprint denominator shrink whenever work is handed on.
 *
 * Values are Jira field DISPLAY NAMES, resolved to ids per instance at fetch time.
 * The literal 'assignee' means the built-in field rather than a custom field.
 * A role may list several fields; matching is a union across them.
 *
 * Declared, not inferred: we use exactly what is configured. If a board leaves a
 * field blank on some tickets that is a data-hygiene matter for that team — the
 * system does not silently substitute a different field.
 */
export interface OwnerFieldsConfig {
    /** Fields naming the developer. Also the sole basis for the sprint burndown denominator. */
    developer?: string[];
    /** Fields naming the QA owner. Counts for daily attribution only. */
    qa?: string[];
    /** Fields naming the UAT owner. Counts for daily attribution only. */
    uat?: string[];
    /**
     * Credit a team member who authored a status transition inside the report window,
     * even when no owner field names them. Catches the handoff case: a dev fixes a
     * ticket, unassigns to pass it to QA, and by 20:00 the ticket names someone else.
     * Off by default — it broadens attribution, so it is opt-in per project.
     */
    creditChangelogAuthor?: boolean;
}

/**
 * Lane Config type: maps semantic roles to arrays of Jira status names.
 *
 * assigneeMode controls how story point attribution works when a ticket is completed:
 *   'separate' (default) — dev and QA are different Jira users; final assignee = developer.
 *   'shared'             — same assignee field is used for both dev and QA; when the final
 *                          assignee has a QA role the changelog is replayed to find the last
 *                          Developer-role assignee and credit is given to them instead.
 *
 * ownerFields declares which Jira fields carry each role (see OwnerFieldsConfig).
 */
export interface LaneConfig {
    assigneeMode?: 'separate' | 'shared';
    ownerFields?: OwnerFieldsConfig;
    todo?: string[];
    in_progress?: string[];
    blocked?: string[];
    in_review?: string[];
    qa?: string[];
    uat?: string[];
    done?: string[];
    reopened?: string[];
    [key: string]: string[] | string | OwnerFieldsConfig | undefined;
}

/**
 * Default owner fields — today's hardcoded behaviour, written down.
 *
 * Lifted verbatim from the resolveFieldIds() calls in reportService so that a
 * project with no ownerFields config behaves EXACTLY as it did before this
 * setting existed. Every CCM project relies on this; changing these values
 * changes every unconfigured project at once.
 */
export const DEFAULT_OWNER_FIELDS: Required<Omit<OwnerFieldsConfig, 'creditChangelogAuthor'>> & {
    creditChangelogAuthor: boolean;
} = {
    developer: ['assignee'],
    qa: ['QA Assignee', 'Assigned QA', 'QA Owner', 'QA'],
    uat: ['UAT Assignee', 'Assigned UAT', 'UAT Owner', 'UAT'],
    creditChangelogAuthor: false,
};

/** The literal that means Jira's built-in assignee field rather than a custom field. */
export const BUILTIN_ASSIGNEE = 'assignee';

/**
 * Hardcoded last-resort default lane config.
 * Matches the original hardcoded values in the codebase.
 */
export const HARDCODED_LANE_CONFIG: LaneConfig = {
    todo: ['TODO', 'To Do', 'Backlog'],
    in_progress: ['In Progress', 'In Development'],
    blocked: ['Blocked', 'Impediment'],
    in_review: ['In Review', 'DEV COMPLETE', 'PR REVIEW', 'Code Review'],
    qa: ['QA', 'Testing', 'In QA', 'QA / Testing'],
    uat: ['PO REVIEW', 'UAT', 'Acceptance Testing', 'UAT / Acceptance'],
    done: ['DONE', 'Done', 'Closed'],
    reopened: ['REOPENED', 'Reopened', 'Issues Found']
};

/** The lane-role fields merged field-by-field by getLaneConfig — everything else on
 *  LaneConfig (ownerFields, assigneeMode) is project-specific and never merged. */
const LANE_ROLE_KEYS: (keyof LaneConfig)[] = [
    'todo', 'in_progress', 'blocked', 'in_review', 'qa', 'uat', 'done', 'reopened',
];

/**
 * Resolve lane config with 3-tier fallback:
 * 1. Project-level DB config
 * 2. .env DEFAULT_JIRA_LANE_CONFIG
 * 3. Hardcoded constant
 *
 * Merges FIELD BY FIELD, and UNIONS rather than replaces each field, rather than
 * replacing the whole object. A project can set `ownerFields` (QA/Developer field
 * mapping) without ever declaring lane-role arrays (`qa`, `in_progress`, etc.) — that
 * used to mean every role silently resolved to an empty list for that project
 * (getDevStatuses() === [], every burndown lane bucket empty), because
 * `if (project?.jiraLaneConfig)` returned the partial object verbatim with no
 * fallback for the roles it didn't specify. Union (not "declared replaces default")
 * so a project can ADD one extra status name to a role — e.g. a custom "Ready to
 * Test" status alongside the standard "QA"/"Testing" — without losing the standard
 * ones its own board may still also use; case-insensitive de-duplication so the
 * result never lists the same status name twice.
 */
export function getLaneConfig(project?: { jiraLaneConfig?: LaneConfig | null }): LaneConfig {
    const envConfig = config.jira.defaultLaneConfig;
    const base: LaneConfig = envConfig || HARDCODED_LANE_CONFIG;

    if (!project?.jiraLaneConfig) {
        return base;
    }

    const merged: LaneConfig = { ...project.jiraLaneConfig };
    for (const key of LANE_ROLE_KEYS) {
        const projectValue = project.jiraLaneConfig[key];
        const baseValue = base[key];
        const declared = Array.isArray(projectValue) ? projectValue : [];
        const fallback = Array.isArray(baseValue) ? baseValue : [];
        const seen = new Set<string>();
        const union: string[] = [];
        for (const status of [...declared, ...fallback]) {
            const dedupeKey = status.toLowerCase();
            if (!seen.has(dedupeKey)) {
                seen.add(dedupeKey);
                union.push(status);
            }
        }
        merged[key] = union;
    }
    return merged;
}

/**
 * Resolve the owner-field config for a project, filling each role from the
 * defaults when it is not configured.
 *
 * Per-role fallback (rather than all-or-nothing) means a project can override
 * just `developer` and keep the standard QA/UAT name lists, which is exactly the
 * Thrive case. An empty array is a deliberate "this role has no field here" —
 * Thrive has no UAT field at all — and is preserved, not replaced by the default.
 */
export function getOwnerFields(project?: { jiraLaneConfig?: LaneConfig | null }): Required<OwnerFieldsConfig> {
    const configured = project?.jiraLaneConfig?.ownerFields
        ?? (config.jira.defaultLaneConfig as LaneConfig | undefined)?.ownerFields;

    return {
        developer: configured?.developer ?? DEFAULT_OWNER_FIELDS.developer,
        qa: configured?.qa ?? DEFAULT_OWNER_FIELDS.qa,
        uat: configured?.uat ?? DEFAULT_OWNER_FIELDS.uat,
        creditChangelogAuthor:
            configured?.creditChangelogAuthor ?? DEFAULT_OWNER_FIELDS.creditChangelogAuthor,
    };
}

/**
 * Every owner-field display name a project needs fetched, minus the built-in
 * assignee (which is always in the base allowlist). Feeds buildIssueFieldList —
 * a configured field that is not requested from Jira silently reads as empty.
 */
export function getOwnerFieldNames(project?: { jiraLaneConfig?: LaneConfig | null }): string[] {
    const owners = getOwnerFields(project);
    const names = [...owners.developer, ...owners.qa, ...owners.uat];
    return Array.from(
        new Set(names.filter(n => typeof n === 'string' && n && n.toLowerCase() !== BUILTIN_ASSIGNEE)),
    );
}

/**
 * Get array of Jira status names for a given semantic role.
 */
export function getStatusesForRole(laneConfig: LaneConfig, role: string): string[] {
    const val = laneConfig[role];
    return Array.isArray(val) ? val : [];
}

/**
 * Check if a Jira status name belongs to a given semantic role (case-insensitive).
 */
export function isStatusInRole(laneConfig: LaneConfig, status: string, role: string): boolean {
    const statuses = getStatusesForRole(laneConfig, role);
    return statuses.some(s => s.toLowerCase() === status.toLowerCase());
}

/**
 * Get all statuses that indicate "active development" work
 * (in_progress + in_review + qa roles).
 * Used by identifyDailyActivity for dev-status scanning.
 */
export function getDevStatuses(laneConfig: LaneConfig): string[] {
    return [
        ...getStatusesForRole(laneConfig, 'in_progress'),
        ...getStatusesForRole(laneConfig, 'in_review'),
        ...getStatusesForRole(laneConfig, 'qa')
    ].map(s => s.toLowerCase());
}

/**
 * Get all statuses that count as "active" for weekly metrics.
 */
export function getActiveMetricStatuses(laneConfig: LaneConfig): string[] {
    return [
        ...getStatusesForRole(laneConfig, 'in_progress'),
        ...getStatusesForRole(laneConfig, 'in_review')
    ];
}

/**
 * Get all statuses that count as "Work In Progress" for the blocked % health calculation.
 * Includes in_progress, in_review, qa, and uat — everything that is actively being worked.
 * Used as the denominator: blockedCount / wipCount >= threshold → Amber.
 */
export function getWorkInProgressStatuses(laneConfig: LaneConfig): string[] {
    return [
        ...getStatusesForRole(laneConfig, 'in_progress'),
        ...getStatusesForRole(laneConfig, 'in_review'),
        ...getStatusesForRole(laneConfig, 'qa'),
        ...getStatusesForRole(laneConfig, 'uat'),
    ];
}


/**
 * Get all statuses that count as "done" for throughput metrics.
 */
export function getDoneStatuses(laneConfig: LaneConfig): string[] {
    return getStatusesForRole(laneConfig, 'done');
}

/**
 * Role label mapping for human-readable prompt output.
 */
const ROLE_LABELS: Record<string, string> = {
    todo: 'TODO',
    in_progress: 'In Progress',
    blocked: 'Blocked',
    in_review: 'DEV COMPLETE / PR REVIEW',
    qa: 'QA',
    uat: 'PO REVIEW / UAT',
    done: 'DONE',
    reopened: 'REOPENED'
};

/**
 * Role descriptions for the AI prompt.
 */
const ROLE_DESCRIPTIONS: Record<string, string> = {
    todo: 'Planned for upcoming work.',
    in_progress: 'Active development. Check comments/dates for real progress.',
    blocked: 'Blocked, waiting for inputs/dependencies.',
    in_review: 'In Code Review or Unit Testing.',
    qa: 'In Testing or Ready for QA. If assigned to a team member, actively being tested (QA In Progress). If unassigned, waiting for QA pickup (In QA queue).',
    uat: 'UAT / Acceptance Testing.',
    done: 'Completed work.',
    reopened: 'Rework / Quality Issue / Issues Found.'
};

/**
 * Format lane config into a markdown text block for the AI prompt.
 * Includes QA assignee distinction note.
 */
export function formatLaneDefinitionsForPrompt(laneConfig: LaneConfig): string {
    const lines: string[] = ['### Lane Definitions (Use these to understand the state):'];

    const roles = ['todo', 'in_progress', 'blocked', 'in_review', 'qa', 'uat', 'done', 'reopened'];

    for (const role of roles) {
        const statuses = getStatusesForRole(laneConfig, role);
        if (statuses.length === 0) continue;

        const label = ROLE_LABELS[role] || role;
        const description = ROLE_DESCRIPTIONS[role] || '';
        const statusList = statuses.join(', ');

        lines.push(`- **${label}** (${statusList}): ${description}`);
    }

    return lines.join('\n');
}
