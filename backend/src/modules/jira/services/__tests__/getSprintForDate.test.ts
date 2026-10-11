import { describe, it, expect } from 'vitest';
import { JiraService } from '../jiraService';

/**
 * getSprintForDate decides which sprint a historical report is scored against. Getting it
 * wrong is not loud: the report still renders, just against the wrong sprint or none at all.
 * These cover the branches that are awkward to reach with live data.
 */
const withSprints = (values: unknown[]): JiraService => {
    const svc = JiraService.forProject({ jiraBaseUrl: 'https://example.invalid' });
    // Stub the axios client rather than the network: this is about date selection logic.
    (svc as unknown as { client: unknown }).client = {
        get: async () => ({ data: { values, isLast: true } }),
    };
    return svc;
};

const SPRINTS = [
    { id: 1, name: 'Sprint A', startDate: '2026-08-01T10:00:00.000Z', endDate: '2026-08-14T10:00:00.000Z' },
    { id: 2, name: 'Sprint B', startDate: '2026-08-14T11:00:00.000Z', endDate: '2026-09-02T10:00:00.000Z' },
    { id: 3, name: 'Sprint C', startDate: '2026-09-02T11:00:00.000Z', endDate: '2026-09-20T10:00:00.000Z' },
];

describe('getSprintForDate', () => {
    it('picks the sprint that was running on the date, not the current one', async () => {
        const svc = withSprints(SPRINTS);
        expect((await svc.getSprintForDate(1, '2026-08-20'))?.name).toBe('Sprint B');
        expect((await svc.getSprintForDate(1, '2026-08-05'))?.name).toBe('Sprint A');
        expect((await svc.getSprintForDate(1, '2026-09-10'))?.name).toBe('Sprint C');
    });

    it('returns null when no sprint covers the date, so the burndown stays unscored', async () => {
        // A genuine gap between sprints must not silently fall back to a neighbouring sprint —
        // that would attribute work to a sprint that was not running.
        const gapped = [
            { id: 1, name: 'Sprint A', startDate: '2026-08-01T10:00:00.000Z', endDate: '2026-08-10T10:00:00.000Z' },
            { id: 2, name: 'Sprint B', startDate: '2026-08-20T10:00:00.000Z', endDate: '2026-08-30T10:00:00.000Z' },
        ];
        expect(await withSprints(gapped).getSprintForDate(1, '2026-08-15')).toBeNull();
    });

    it('returns null for a date before any sprint existed', async () => {
        expect(await withSprints(SPRINTS).getSprintForDate(1, '2026-07-01')).toBeNull();
    });

    it('treats a sprint with no end date as still running', async () => {
        const open = [{ id: 9, name: 'Open Sprint', startDate: '2026-08-01T10:00:00.000Z' }];
        expect((await withSprints(open).getSprintForDate(1, '2026-12-25'))?.name).toBe('Open Sprint');
    });

    it('prefers a sprint created on THIS board over another team\'s that also covers the date', async () => {
        // A board's sprint list includes sprints owned by other boards whose issues it shows.
        // Team Beta's board carries "Beta - Nets" (its own) and "Rho - Nets" (board 439)
        // starting 70 minutes apart; choosing on start time alone picked the neighbour's
        // sprint, and Beta scored 0 SP on every backfilled day.
        const shared = [
            { id: 1, name: 'Beta - Nets', originBoardId: 307, startDate: '2026-08-12T14:50:37.000Z', endDate: '2026-09-02T13:28:06.000Z' },
            { id: 2, name: 'Rho - Nets', originBoardId: 439, startDate: '2026-08-12T16:00:39.000Z', endDate: '2026-09-02T04:00:00.000Z' },
        ];
        expect((await withSprints(shared).getSprintForDate(307, '2026-08-20'))?.name).toBe('Beta - Nets');
        // ...and from Rho's own board, Rho's sprint is the right answer.
        expect((await withSprints(shared).getSprintForDate(439, '2026-08-20'))?.name).toBe('Rho - Nets');
    });

    it('falls back to the most recently started when provenance does not distinguish them', async () => {
        const overlapping = [
            { id: 1, name: 'Long Sprint', originBoardId: 1, startDate: '2026-08-01T10:00:00.000Z', endDate: '2026-09-30T10:00:00.000Z' },
            { id: 2, name: 'Recent Sprint', originBoardId: 1, startDate: '2026-08-25T10:00:00.000Z', endDate: '2026-09-10T10:00:00.000Z' },
        ];
        expect((await withSprints(overlapping).getSprintForDate(1, '2026-08-28'))?.name).toBe('Recent Sprint');
    });

    it('prefers completeDate over the planned endDate', async () => {
        // A sprint closed early should not claim dates after it actually finished.
        const closedEarly = [{
            id: 5, name: 'Closed Early',
            startDate: '2026-08-01T10:00:00.000Z',
            endDate: '2026-08-30T10:00:00.000Z',
            completeDate: '2026-08-10T10:00:00.000Z',
        }];
        expect((await withSprints(closedEarly).getSprintForDate(1, '2026-08-05'))?.name).toBe('Closed Early');
        expect(await withSprints(closedEarly).getSprintForDate(1, '2026-08-20')).toBeNull();
    });

    it('returns null rather than throwing when Jira fails', async () => {
        const svc = JiraService.forProject({ jiraBaseUrl: 'https://example.invalid' });
        (svc as unknown as { client: unknown }).client = {
            get: async () => { throw new Error('Jira down'); },
        };
        expect(await svc.getSprintForDate(1, '2026-08-20')).toBeNull();
    });

    it('rejects an unparseable date instead of guessing', async () => {
        expect(await withSprints(SPRINTS).getSprintForDate(1, 'not-a-date')).toBeNull();
    });
});
