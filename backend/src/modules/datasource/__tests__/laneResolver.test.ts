import { describe, it, expect } from 'vitest';
import { resolveSemanticLane } from '../laneResolver';
import { LaneConfig } from '../../../common/laneDefaults';

const config: LaneConfig = {
    todo: ['Backlog', 'To Do'],
    in_progress: ['In Progress', 'Active'],
    blocked: ['Blocked'],
    in_review: ['Code Review'],
    qa: ['In QA', 'Resolved'],
    uat: ['UAT'],
    done: ['Done', 'Closed'],
    reopened: ['Reopened'],
};

describe('resolveSemanticLane', () => {
    it('maps Jira-style status names', () => {
        expect(resolveSemanticLane('In Progress', config)).toBe('in_progress');
        expect(resolveSemanticLane('Done', config)).toBe('done');
    });

    it('maps Azure DevOps-style states to the same semantic lanes', () => {
        expect(resolveSemanticLane('Active', config)).toBe('in_progress');
        expect(resolveSemanticLane('Resolved', config)).toBe('qa');
        expect(resolveSemanticLane('Closed', config)).toBe('done');
    });

    it('is case-insensitive and trims whitespace', () => {
        expect(resolveSemanticLane('  in progress  ', config)).toBe('in_progress');
        expect(resolveSemanticLane('CLOSED', config)).toBe('done');
    });

    it('returns undefined for unknown states', () => {
        expect(resolveSemanticLane('Parked', config)).toBeUndefined();
    });

    it('prioritises blocked/reopened over other lanes when overlapping', () => {
        const overlap: LaneConfig = {
            in_progress: ['Active'],
            blocked: ['Active'],
        };
        expect(resolveSemanticLane('Active', overlap)).toBe('blocked');
    });
});
