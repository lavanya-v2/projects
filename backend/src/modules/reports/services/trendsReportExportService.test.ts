import { describe, it, expect, vi } from 'vitest';

// This file only exercises buildTrendsHtml, a pure string builder -- but the
// module also imports performanceSyncService (for getMergedTrendsData, not
// used here), which pulls in Sequelize models whose decorators need real
// emitDecoratorMetadata (esbuild doesn't emit it) and force a live DB
// connection attempt otherwise. Mock it away rather than pull in the model
// mock cascade for code this file never calls.
vi.mock('./performanceSyncService', () => ({ performanceSyncService: {} }));

import { buildTrendsHtml, MergedProjectTrends } from './trendsReportExportService';

function sprintProject(): MergedProjectTrends {
    return {
        projectId: 1,
        projectName: 'Sprint Project',
        accountName: 'Acme',
        productivity: {
            sprints: [
                { syncId: 1, sprintName: 'Sprint 12', startDate: '2026-07-01', endDate: '2026-07-14', productivity: 88, defectDensity: 0, reopenRatio: 0 } as any,
            ],
            summary: { current: 88, avg: 80, trend: 'up', trendPct: 8, health: 'green' },
            metricKind: 'percent',
        },
        defectDensity: { sprints: [], summary: { current: 0, avg: 0, trend: 'neutral', trendPct: 0, health: 'green' } },
        reopenRatio: { sprints: [], summary: { current: 0, avg: 0, trend: 'neutral', trendPct: 0, health: 'green' } },
    };
}

function kanbanProject(): MergedProjectTrends {
    return {
        projectId: 2,
        projectName: 'Kanban Project',
        accountName: 'Acme',
        productivity: {
            // spDone is the real throughput; `productivity` (spDone/spPlanned%) is
            // populated too, since performanceSyncService always computes it, but
            // must NOT be what gets plotted/labelled for a throughput project.
            sprints: [
                { syncId: 2, sprintName: 'Cycle: Jun 1 - Jun 5, 2026', startDate: '2026-06-01', endDate: '2026-06-05', productivity: 43.75, defectDensity: 0, reopenRatio: 0, spDone: 7, spPlanned: 16 } as any,
            ],
            summary: { current: 7, avg: 5, trend: 'up', trendPct: 40, health: 'green' },
            metricKind: 'throughput',
        },
        defectDensity: { sprints: [], summary: { current: 0, avg: 0, trend: 'neutral', trendPct: 0, health: 'green' } },
        reopenRatio: { sprints: [], summary: { current: 0, avg: 0, trend: 'neutral', trendPct: 0, health: 'green' } },
    };
}

describe('buildTrendsHtml — unit correctness (sprint % vs Kanban throughput SP)', () => {
    it('a sprint project shows its percentage summary with a % unit', () => {
        const html = buildTrendsHtml([sprintProject()], 'Trends');
        expect(html).toContain('Current: <b>88%</b>');
    });

    it('a sprint project plots the percentage value, not spDone, in its bar/table', () => {
        const html = buildTrendsHtml([sprintProject()], 'Trends');
        expect(html).toContain('88.0%'); // bar chart value label (1 decimal)
    });

    it('a Kanban (throughput) project shows its SP summary with an SP unit, not %', () => {
        const html = buildTrendsHtml([kanbanProject()], 'Trends');
        // This is the exact bug: current=7 (SP) must not render as "7%".
        expect(html).toContain('Current: <b>7 SP</b>');
        expect(html).not.toContain('Current: <b>7%</b>');
    });

    it('a Kanban project plots spDone (7), not the percentage (43.75), in its bar/table', () => {
        const html = buildTrendsHtml([kanbanProject()], 'Trends');
        expect(html).toContain('7.0 SP'); // bar chart value label
        expect(html).not.toContain('43.8'); // the percentage must not appear at all
    });

    it('a Kanban project labels its period column "Span", not "Sprint"', () => {
        const html = buildTrendsHtml([kanbanProject()], 'Trends');
        expect(html).toContain('<th>Span</th>');
    });

    it('a sprint project keeps the "Sprint" column label', () => {
        const html = buildTrendsHtml([sprintProject()], 'Trends');
        expect(html).toContain('<th>Sprint</th>');
    });

    it('mixed decks: each project keeps its own correct unit independently', () => {
        const html = buildTrendsHtml([sprintProject(), kanbanProject()], 'Trends');
        expect(html).toContain('Current: <b>88%</b>');
        expect(html).toContain('Current: <b>7 SP</b>');
    });
});
