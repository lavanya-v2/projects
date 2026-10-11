/**
 * Estimation-unit labels. Projects estimate either in story points (default) or
 * in hours. UI code keys off the project/report's `estimationType` to render the
 * correct unit label instead of hardcoding "SP"/"pts"/"Story Points".
 */
export type EstimationType = 'story_points' | 'hours';

export interface UnitLabels {
    /** Full noun, e.g. "Story Points" / "Hours". */
    label: string;
    /** Lowercase short suffix, e.g. "pts" / "hrs". */
    abbrev: string;
    /** Compact column/axis label, e.g. "SP" / "Hrs". */
    short: string;
}

const STORY_POINTS: UnitLabels = { label: 'Story Points', abbrev: 'pts', short: 'SP' };
const HOURS: UnitLabels = { label: 'Hours', abbrev: 'hrs', short: 'Hrs' };

/** Resolve unit labels for an estimation type (defaults to story points). */
export function unitLabels(estimationType?: EstimationType | string | null): UnitLabels {
    return estimationType === 'hours' ? HOURS : STORY_POINTS;
}

export function isHours(estimationType?: EstimationType | string | null): boolean {
    return estimationType === 'hours';
}
