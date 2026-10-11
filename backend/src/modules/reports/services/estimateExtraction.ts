/**
 * Estimate extraction — shared logic for reading a ticket's estimate value, in
 * whatever unit the project uses (story points or hours).
 *
 * The whole performance pipeline stores estimates in a single numeric field
 * (PerfTicketFact.storyPoints) and sums it downstream regardless of unit. The
 * ONLY place the unit matters at capture time is *which Jira field* the number
 * comes from. This module centralizes that decision.
 *
 * Backward compatibility is non-negotiable: for points projects (the default),
 * `extractEstimate` reproduces the historical extraction
 *   fields[spFieldId] ?? fields['story_points'] ?? fields['customfield_10016'] ?? 0
 * byte-for-byte.
 */

export interface EstimationConfig {
    estimationType?: 'story_points' | 'hours' | null;
    hoursSource?: 'time_tracking' | 'custom_field' | null;
    hoursFieldName?: string | null;
}

export interface ResolvedEstimateFields {
    spFieldId: string;
    hoursFieldId?: string | null;
}

interface FieldResolver {
    getFieldIdByName(name: string): Promise<string | null | undefined>;
}

const SECONDS_PER_HOUR = 3600;

/** True when the project estimates in hours rather than story points. */
export function isHoursProject(project: EstimationConfig | null | undefined): boolean {
    return project?.estimationType === 'hours';
}

/**
 * Resolve the Jira field id(s) needed to read estimates for a project.
 * Always resolves the Story Points field (used by points projects and as a
 * harmless default). For hours + custom_field projects, also resolves the
 * configured custom field by its display name.
 */
export async function resolveEstimateFields(
    project: EstimationConfig | null | undefined,
    jira: FieldResolver,
): Promise<ResolvedEstimateFields> {
    let spFieldId = 'story_points';
    try {
        const resolved = (await jira.getFieldIdByName('Story Points'))
            || (await jira.getFieldIdByName('Story point estimate'));
        if (resolved) spFieldId = resolved;
    } catch { /* fall back to 'story_points' */ }

    let hoursFieldId: string | null = null;
    if (isHoursProject(project) && project?.hoursSource === 'custom_field' && project.hoursFieldName) {
        try {
            const resolved = await jira.getFieldIdByName(project.hoursFieldName);
            if (resolved) hoursFieldId = resolved;
        } catch { /* leave null; extraction falls back to time-tracking */ }
    }
    return { spFieldId, hoursFieldId };
}

/**
 * A bound reader: given a project's config and resolved field ids, returns a
 * function that reads the estimate off a Jira issue's `fields`. Lets call sites
 * thread a single closure instead of spFieldId + config + hoursFieldId.
 */
export type EstimateReader = (fields: any) => number;

export async function makeEstimateReader(
    project: EstimationConfig | null | undefined,
    jira: FieldResolver,
): Promise<EstimateReader> {
    const resolved = await resolveEstimateFields(project, jira);
    return (fields: any) => extractEstimate(fields, project, resolved);
}

/** Historical story-points read — preserved verbatim for points projects. */
function readStoryPoints(fields: any, spFieldId: string): number {
    return fields?.[spFieldId] ?? fields?.['story_points'] ?? fields?.['customfield_10016'] ?? 0;
}

/** Read Jira built-in time-tracking Original Estimate, in hours. */
function readTimeTrackingHours(fields: any): number {
    const secs = Number(
        fields?.timetracking?.originalEstimateSeconds
        ?? fields?.timeoriginalestimate
        ?? fields?.aggregatetimeoriginalestimate
        ?? 0,
    );
    return secs > 0 ? secs / SECONDS_PER_HOUR : 0;
}

/** Read hours from a custom numeric field, if one was resolved. */
function readCustomFieldHours(fields: any, hoursFieldId?: string | null): number {
    if (!hoursFieldId) return 0;
    const v = Number(fields?.[hoursFieldId] ?? 0);
    return v > 0 ? v : 0;
}

/**
 * Extract a ticket's estimate value in the project's unit.
 * - points: unchanged historical behavior.
 * - hours + time_tracking: read Original Estimate (seconds → hours); fall back to custom field.
 * - hours + custom_field: read the custom field; fall back to time-tracking.
 */
export function extractEstimate(
    fields: any,
    project: EstimationConfig | null | undefined,
    resolved: ResolvedEstimateFields,
): number {
    if (!isHoursProject(project)) {
        return readStoryPoints(fields, resolved.spFieldId);
    }
    const fromTimeTracking = readTimeTrackingHours(fields);
    const fromCustom = readCustomFieldHours(fields, resolved.hoursFieldId);
    const primary = project?.hoursSource === 'custom_field'
        ? (fromCustom > 0 ? fromCustom : fromTimeTracking)   // custom first, time-tracking fallback
        : (fromTimeTracking > 0 ? fromTimeTracking : fromCustom); // time-tracking first, custom fallback
    if (primary > 0) return primary;
    // Final fallback: Excel-sourced hours projects inject the estimate into the
    // generic story-points field (customfield_10016) since they have no Jira
    // time-tracking. Harmless for Jira hours projects (their SP field is empty).
    return Number(readStoryPoints(fields, resolved.spFieldId)) || 0;
}
