import { LaneConfig, getStatusesForRole } from '../../common/laneDefaults';
import { SemanticLane } from './types';

const LANE_ORDER: SemanticLane[] = [
    'blocked',
    'reopened',
    'in_review',
    'qa',
    'uat',
    'in_progress',
    'done',
    'todo',
];

export function resolveSemanticLane(
    state: string,
    laneConfig: LaneConfig,
): SemanticLane | undefined {
    if (!state) return undefined;
    const needle = state.trim().toLowerCase();
    for (const lane of LANE_ORDER) {
        const statuses = getStatusesForRole(laneConfig, lane);
        if (statuses.some(s => s.toLowerCase() === needle)) {
            return lane;
        }
    }
    return undefined;
}
