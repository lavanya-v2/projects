// Field policy for Jira issue fetches.
//
// Historically every issue fetch asked Jira for `fields=*all`, which pulled the
// ticket description, every comment body, attachment metadata and worklogs across
// the wire on every sync — none of which the product reads. That is an
// unnecessary ingestion of customer personal data, so fetches now send an
// explicit allowlist built from the fields actually consumed by the codebase.
//
// KNOWN ASYMMETRY: Jira offers no projection that returns comment metadata
// (created / author) without also returning the comment body. reportService
// needs that metadata for its "Comment added" daily-activity signal, so
// `comment` stays in the allowlist and the bodies are stripped at the
// application boundary by sanitizeIssue() instead. `description` genuinely never
// leaves Jira; comment bodies leave Jira but never reach the rest of the app.

// Imported directly rather than via the common/utils barrel: the barrel pulls in
// blockedTicketAnalyzer -> Sequelize models, which drags the whole ORM into any
// module that only wants a logger (and breaks unit tests that import this file).
import { logger } from '../../../common/utils/logger';
import { redactPii } from '../../../common/utils/piiRedactor';
import { getOwnerFieldNames, type LaneConfig } from '../../../common/laneDefaults';

/**
 * Fields requested on every issue fetch. Derived from an audit of every
 * `fields.X` read in backend/src. Deliberately excludes `description`,
 * `environment`, `attachment` and `worklog`.
 */
export const BASE_ISSUE_FIELDS: readonly string[] = [
    'summary',
    'status',
    'issuetype',
    'priority',
    'created',
    'updated',
    'duedate',
    'resolutiondate',
    'resolution',
    'labels',
    'parent',
    'issuelinks',
    'subtasks',
    'timetracking',
    'timeoriginalestimate',
    'aggregatetimeoriginalestimate',
    'assignee',
    'reporter',
    'creator',
    'comment',
    'project',
    'statuscategorychangedate',
];

/**
 * Custom fields referenced by hardcoded id somewhere in the codebase. Used as a
 * floor so a name-resolution failure still yields a working (if narrower) fetch.
 */
export const FALLBACK_CUSTOM_FIELDS: readonly string[] = [
    'customfield_10000', // Development Information (PR/commit data)
    'customfield_10016', // Story Points
    'customfield_10020', // Sprint
    'customfield_10024', // Story Points (myccmortgage)
    'customfield_10204', // QA Assignee
    'customfield_10251', // Environment(s)
    'customfield_10414', // Root Cause
    'customfield_10440', // Root Cause (alt)
    'customfield_10441', // UAT Assignee
];

/** Custom-field display names resolved dynamically, since ids vary per Jira instance. */
const DYNAMIC_FIELD_NAMES: readonly string[] = [
    'Story Points',
    'Story point estimate',
    'Sprint',
    'QA Assignee',
    'Assigned QA',
    'QA Owner',
    'QA',
    'UAT Assignee',
    'Assigned UAT',
    'UAT Owner',
    'UAT',
    'Environment(s)',
    'Environment',
    'Environment found on',
    'Development',
];

interface FieldSource {
    getFields(): Promise<any[]>;
}

/**
 * Compose the field allowlist for a project: the static base list, plus any
 * custom-field ids resolved by display name against this Jira instance.
 *
 * Never returns '*all'. On failure it falls back to the static lists rather than
 * to the wildcard — failing open would silently reinstate description ingestion,
 * which is the exact thing this module exists to prevent. A project whose custom
 * field cannot be resolved surfaces as a missing metric, not a privacy regression.
 */
export async function buildIssueFieldList(
    jira: FieldSource,
    project?: { hoursFieldName?: string | null; jiraLaneConfig?: LaneConfig | null },
): Promise<string[]> {
    const fields = new Set<string>([...BASE_ISSUE_FIELDS, ...FALLBACK_CUSTOM_FIELDS]);

    try {
        const wanted = [...DYNAMIC_FIELD_NAMES];
        if (project?.hoursFieldName) wanted.push(project.hoursFieldName);
        // Owner fields this project declares (e.g. Thrive's "Developer"). Without this the
        // configured field is never requested and every read of it returns empty — the
        // failure mode looks like "nobody owns anything" rather than a config error.
        wanted.push(...getOwnerFieldNames(project));

        const available = await jira.getFields();
        // A display name can map to several ids (a project-scoped field and a global
        // one often share a name). Collect them all: requesting a field the issue
        // does not carry is harmless, whereas keeping only one id risks fetching the
        // empty duplicate while the reader resolves the populated one, or vice versa.
        const byName = new Map<string, string[]>();
        for (const f of available ?? []) {
            if (!f?.name || !f?.id) continue;
            const key = String(f.name).toLowerCase();
            const ids = byName.get(key);
            if (ids) ids.push(String(f.id));
            else byName.set(key, [String(f.id)]);
        }

        for (const name of wanted) {
            for (const id of byName.get(name.toLowerCase()) ?? []) fields.add(id);
        }
    } catch (error: any) {
        logger.warn(
            `Could not resolve dynamic Jira field ids (${error?.message ?? error}); ` +
            `falling back to the static field allowlist. Some custom-field metrics may be empty.`,
            'JiraFields',
        );
    }

    return Array.from(fields);
}

/**
 * Resolve the Jira "Environment" custom field id used for production-bug
 * classification. Tries known display names in order, skipping any name that
 * resolves to Jira's native system "Environment" field (id === 'environment',
 * a legacy free-text field with no selectable .value — structurally incapable
 * of ever matching a Production/Prod value check, so accepting it is equivalent
 * to not finding a field at all). Falls back to a last-resort hardcoded id
 * shared with every other unresolvable-field fallback in this file.
 */
export async function resolveEnvironmentFieldId(
    jira: { getFieldIdByName(name: string): Promise<string | undefined> },
): Promise<string> {
    const candidates = ['Environment(s)', 'Environment', 'Environment found on'];
    for (const name of candidates) {
        const id = await jira.getFieldIdByName(name);
        if (id && id.startsWith('customfield_')) return id;
    }
    return 'customfield_10251';
}

/**
 * Strip anything the product does not read and must not persist: the ticket
 * description and every comment body. Comment id/created/author are preserved
 * because the daily-activity signal depends on them.
 *
 * Mutates the issue in place — these objects are freshly deserialized from the
 * Jira response and are not shared.
 */
export function sanitizeIssue<T extends { fields?: any }>(issue: T): T {
    const fields = issue?.fields;
    if (!fields) return issue;

    delete fields.description;
    delete fields.environment;
    delete fields.attachment;
    delete fields.worklog;

    const comments = fields.comment?.comments;
    if (Array.isArray(comments)) {
        for (const comment of comments) {
            if (!comment) continue;
            delete comment.body;
            delete comment.renderedBody;
            delete comment.jsdPublic;
        }
    }

    // Parent issues carry their own nested fields block (we read parent.fields.summary).
    if (fields.parent?.fields) {
        delete fields.parent.fields.description;
        delete fields.parent.fields.environment;
    }

    return issue;
}

export function sanitizeIssues<T extends { fields?: any }>(issues: T[]): T[] {
    if (!Array.isArray(issues)) return issues;
    for (const issue of issues) sanitizeIssue(issue);
    return issues;
}

/**
 * Mask personal data in ticket titles in place, for a project with redaction
 * enabled. Covers the issue's own summary and its parent/epic title, both of
 * which are persisted and sent to the AI.
 *
 * Call this once, immediately after fetching — everything downstream reads the
 * same objects, so a single pass covers every consumer.
 */
export function redactIssueTitles<T extends { fields?: any }>(issues: T[], enabled: boolean): T[] {
    if (!enabled || !Array.isArray(issues)) return issues;

    for (const issue of issues) {
        const fields = issue?.fields;
        if (!fields) continue;

        if (typeof fields.summary === 'string') {
            fields.summary = redactPii(fields.summary);
        }
        if (typeof fields.parent?.fields?.summary === 'string') {
            fields.parent.fields.summary = redactPii(fields.parent.fields.summary);
        }
    }
    return issues;
}
