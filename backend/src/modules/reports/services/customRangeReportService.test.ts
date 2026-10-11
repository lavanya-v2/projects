import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../models/Project', () => ({ Project: { findAll: vi.fn() } }));
vi.mock('../../../models/DailyBoardSnapshot', () => ({ DailyBoardSnapshot: { findAll: vi.fn() } }));
vi.mock('../../ai/services/aiService', () => ({
    aiService: { scrubText: (t: string) => t, composeRangeAchievements: vi.fn() },
}));
vi.mock('../../../common/utils', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('ioredis', () => ({ default: vi.fn() }));

import { validateWindow, reduceSnapshots, renderText, renderEml, CustomRangeError } from './customRangeReportService';

const win = { startDate: '2026-09-15', endDate: '2026-09-22' };

describe('validateWindow', () => {
    it('accepts a 15-day window ending today', () => {
        expect(validateWindow('2026-09-08', '2026-09-22', '2026-09-22')).toEqual({ startDate: '2026-09-08', endDate: '2026-09-22' });
    });
    it('rejects a 16-day window', () => {
        expect(() => validateWindow('2026-09-07', '2026-09-22', '2026-09-22')).toThrow(CustomRangeError);
    });
    it('rejects a future start date, with or without a future end', () => {
        expect(() => validateWindow('2026-09-23', '2026-09-23', '2026-09-22')).toThrow(/startDate cannot be in the future/);
        expect(() => validateWindow('2026-09-23', '2026-09-25', '2026-09-22')).toThrow(/startDate cannot be in the future/);
    });
    it('accepts today as both start and end', () => {
        expect(validateWindow('2026-09-22', '2026-09-22', '2026-09-22')).toEqual({ startDate: '2026-09-22', endDate: '2026-09-22' });
    });
    it('rejects a future end date and reversed dates and bad formats', () => {
        expect(() => validateWindow('2026-09-20', '2026-09-23', '2026-09-22')).toThrow(/future/);
        expect(() => validateWindow('2026-09-22', '2026-09-20', '2026-09-22')).toThrow(/after/);
        expect(() => validateWindow('22-09-2026', '2026-09-22', '2026-09-22')).toThrow(/YYYY-MM-DD/);
        expect(() => validateWindow('2026-02-30', '2026-03-01', '2026-09-22')).toThrow(/YYYY-MM-DD/);
    });
});

describe('reduceSnapshots', () => {
    const snaps = [
        { date: '2026-09-15', overallHealth: 'Green', executiveRisks: 'old risk', workSummary: 'w15',
          ticketDetailsStructured: [{ key: 'ABC-1', issueType: 'Story', status: 'In Progress', description: 'working' }],
          blockedTickets: [{ key: 'ABC-9', summary: 'blocked then cleared', status: 'Blocked', assignee: 'A' }] },
        { date: '2026-09-17', overallHealth: 'Amber', executiveRisks: 'mid risk', workSummary: 'w17',
          ticketDetailsStructured: [{ key: 'ABC-2', issueType: 'Bug', status: 'Open', description: 'bug' }],
          blockedTickets: [{ key: 'ABC-9', summary: 'blocked then cleared', status: 'Blocked', assignee: 'A' },
                           { key: 'ABC-7', summary: 'still blocked', status: 'Blocked', assignee: 'B' }] },
        { date: '2026-09-21', overallHealth: 'Green', executiveRisks: 'latest risk', workSummary: 'w21',
          ticketDetailsStructured: [{ key: 'ABC-1', issueType: 'Story', status: 'Done', description: 'shipped to prod' }],
          blockedTickets: [{ key: 'ABC-7', summary: 'still blocked', status: 'Blocked', assignee: 'B' }] },
    ];

    it('keeps only the latest state per ticket', () => {
        const r = reduceSnapshots(snaps, win);
        const t = r.tickets.find(x => x.key === 'ABC-1')!;
        expect(t.status).toBe('Done');
        expect(t.description).toBe('shipped to prod');
        expect(r.tickets.map(x => x.key)).toEqual(['ABC-1', 'ABC-2']);
    });
    it('lists only blockers still blocked on the last snapshot, with the start of the run', () => {
        const r = reduceSnapshots(snaps, win);
        expect(r.blockers).toHaveLength(1);
        expect(r.blockers[0].key).toBe('ABC-7');
        expect(r.blockers[0].blockedSince).toBe('2026-09-17');
    });
    it('takes risks from the last day only and reports missing dates', () => {
        const r = reduceSnapshots(snaps, win);
        expect(r.risks).toEqual({ text: 'latest risk', asOf: '2026-09-21' });
        expect(r.missingDates).toEqual(['2026-09-16', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-22']);
    });
    it('uses the weekly rollupHealth rule and is order independent', () => {
        const a = reduceSnapshots(snaps, win);
        const b = reduceSnapshots([...snaps].reverse(), win);
        expect(a.health.status).toBe('Green'); // avg 0.33 < 0.35
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
    it('renders identical text for identical input', () => {
        const r = reduceSnapshots(snaps, win);
        const rep: any = {
            project: { id: 1, code: 'X', name: 'X' }, window: win, calendarDays: 8, snapshotCount: 3, missingDates: r.missingDates,
            health: r.health, healthTimeline: r.healthTimeline, achievements: { text: '## T\nDone.', source: 'ai' },
            blockers: r.blockers, risks: r.risks, tickets: r.tickets,
        };
        expect(renderText(rep)).toBe(renderText(rep));
        expect(renderText(rep)).toContain('ABC-7'); // a blocker keeps its key
    });
    it('does not list tickets in the downloaded txt or eml', () => {
        const r = reduceSnapshots(snaps, win);
        const rep: any = {
            project: { id: 1, code: 'X', name: 'X' }, window: win, calendarDays: 8, snapshotCount: 3, missingDates: r.missingDates,
            health: r.health, healthTimeline: r.healthTimeline, achievements: { text: '## T\nDone.', source: 'ai' },
            blockers: r.blockers, risks: r.risks, tickets: r.tickets,
        };
        for (const out of [renderText(rep), renderEml(rep, 'a@b.c')]) {
            expect(out).not.toMatch(/ticket details/i);
            expect(out).not.toContain('ABC-1');
            expect(out).not.toContain('ABC-2');
        }
    });

    it('falls back to ticketDetails text + ticketKeys statuses when the structured array is absent', () => {
        const old = [
            { date: '2026-09-15', ticketKeys: { 'ABC-1': 'Testing' }, ticketDetails: '- ABC-1: Story - checkout redesign in testing\n- ABC-2: [Bug] timeout fix' },
            { date: '2026-09-18', ticketKeys: { 'ABC-1': 'Closed', 'ABC-2': 'Closed' }, ticketDetails: '- ABC-1: Story - checkout redesign released\n- ABC-2: Bug - timeout fixed' },
        ];
        const r = reduceSnapshots(old, win);
        expect(r.tickets).toEqual([
            { key: 'ABC-1', issueType: 'Story', status: 'Closed', description: 'checkout redesign released', asOf: '2026-09-18' },
            { key: 'ABC-2', issueType: 'Bug', status: 'Closed', description: 'timeout fixed', asOf: '2026-09-18' },
        ]);
    });
});
