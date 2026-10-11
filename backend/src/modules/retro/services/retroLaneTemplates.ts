/**
 * Retro lane presets.
 *
 * Mirrors the shape of common/laneDefaults.ts. The frontend keeps a matching
 * literal in features/retro-board/laneTemplates.ts — this codebase has no shared
 * types package, and features/risk-management/types.ts already establishes
 * duplication as the convention.
 */

import type { RetroLane } from '../../../models/RetroBoard';

export type RetroLaneTemplateKey =
    | 'WENT_WELL'
    | 'START_STOP_CONTINUE'
    | 'FOUR_LS'
    | 'MAD_SAD_GLAD'
    | 'CUSTOM';

export const RETRO_LANE_TEMPLATES: Record<Exclude<RetroLaneTemplateKey, 'CUSTOM'>, RetroLane[]> = {
    WENT_WELL: [
        { key: 'went_well', name: 'What Went Well', order: 0, color: '#2e7d32' },
        { key: 'can_be_better', name: 'What Can Be Better', order: 1, color: '#e65100' },
        { key: 'action_items', name: 'Action Items', order: 2, color: '#1565c0' },
    ],
    START_STOP_CONTINUE: [
        { key: 'start', name: 'Start', order: 0, color: '#2e7d32' },
        { key: 'stop', name: 'Stop', order: 1, color: '#c62828' },
        { key: 'continue', name: 'Continue', order: 2, color: '#1565c0' },
    ],
    FOUR_LS: [
        { key: 'liked', name: 'Liked', order: 0, color: '#2e7d32' },
        { key: 'learned', name: 'Learned', order: 1, color: '#1565c0' },
        { key: 'lacked', name: 'Lacked', order: 2, color: '#e65100' },
        { key: 'longed_for', name: 'Longed For', order: 3, color: '#6a1b9a' },
    ],
    MAD_SAD_GLAD: [
        { key: 'mad', name: 'Mad', order: 0, color: '#c62828' },
        { key: 'sad', name: 'Sad', order: 1, color: '#e65100' },
        { key: 'glad', name: 'Glad', order: 2, color: '#2e7d32' },
    ],
};

export const DEFAULT_LANE_TEMPLATE: RetroLaneTemplateKey = 'WENT_WELL';

export const MIN_LANES = 2;
export const MAX_LANES = 6;
export const MAX_LANE_NAME_LENGTH = 60;

const LANE_KEY_PATTERN = /^[a-z0-9_]{1,40}$/;

/** Derive a stable key from a lane name, e.g. "What Went Well" -> "what_went_well". */
export function slugifyLaneName(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
}

export class LaneValidationError extends Error {
    statusCode = 400;
    constructor(message: string) {
        super(message);
        this.name = 'LaneValidationError';
    }
}

/**
 * Validate and normalise a lane set, assigning keys where absent.
 *
 * Lanes live in JSONB with no foreign key from retro_items.lane_key, so this is
 * the only thing standing between a lane edit and orphaned items. Every entry
 * point that writes lanes must go through here.
 */
export function normaliseLanes(input: Partial<RetroLane>[], existing?: RetroLane[]): RetroLane[] {
    if (!Array.isArray(input) || input.length < MIN_LANES || input.length > MAX_LANES) {
        throw new LaneValidationError(`A board needs between ${MIN_LANES} and ${MAX_LANES} lanes`);
    }

    const seenKeys = new Set<string>();
    const existingByKey = new Map((existing ?? []).map(l => [l.key, l]));

    const lanes = input.map((lane, idx) => {
        const name = (lane.name ?? '').trim();
        if (!name) throw new LaneValidationError('Every lane needs a name');
        if (name.length > MAX_LANE_NAME_LENGTH) {
            throw new LaneValidationError(`Lane name must be ${MAX_LANE_NAME_LENGTH} characters or fewer`);
        }

        // Keys are immutable once created: retro_items.lane_key points at them
        // and there is no FK to cascade a rename through. Names stay editable.
        let key = lane.key ?? slugifyLaneName(name);
        if (!key) key = `lane_${idx}`;
        if (!LANE_KEY_PATTERN.test(key)) {
            throw new LaneValidationError(`Invalid lane key: ${key}`);
        }
        if (seenKeys.has(key)) {
            throw new LaneValidationError(`Duplicate lane key: ${key}`);
        }
        seenKeys.add(key);

        return {
            key,
            name,
            order: idx,
            color: lane.color ?? existingByKey.get(key)?.color ?? '#546e7a',
        };
    });

    return lanes;
}

export function resolveTemplateLanes(
    template: RetroLaneTemplateKey | undefined,
    customLanes?: Partial<RetroLane>[]
): RetroLane[] {
    if (template === 'CUSTOM') {
        if (!customLanes) throw new LaneValidationError('Custom lane sets must supply lanes');
        return normaliseLanes(customLanes);
    }
    const preset = RETRO_LANE_TEMPLATES[(template ?? DEFAULT_LANE_TEMPLATE) as Exclude<RetroLaneTemplateKey, 'CUSTOM'>];
    if (!preset) throw new LaneValidationError(`Unknown lane template: ${template}`);
    return preset.map(l => ({ ...l }));
}
