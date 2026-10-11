import { describe, it, expect } from 'vitest';
import { ExcelAdapter, ExcelImportSource } from '../excelAdapter';
import { LaneConfig } from '../../../common/laneDefaults';

const laneConfig: LaneConfig = {
    todo: ['Open'],
    in_progress: ['WIP'],
    done: ['Completed'],
};

function src(hasHistory: boolean): ExcelImportSource {
    return {
        rows: [
            {
                extId: 'E-1',
                title: 'First',
                type: 'Story',
                status: 'WIP',
                assigneeEmail: 'alice@example.com',
                storyPoints: 5,
                sprintName: 'Sprint 1',
                sprintStart: new Date('2026-04-01'),
                sprintEnd: new Date('2026-04-14'),
                createdAt: new Date('2026-04-02'),
                updatedAt: new Date('2026-04-08'),
                statusChangedOn: new Date('2026-04-05'),
            },
            {
                extId: 'E-2',
                title: 'Second',
                type: 'Bug',
                status: 'Completed',
                assigneeEmail: 'bob@example.com',
                sprintName: 'Sprint 1',
                sprintStart: new Date('2026-04-01'),
                sprintEnd: new Date('2026-04-14'),
                createdAt: new Date('2026-04-03'),
                updatedAt: new Date('2026-04-10'),
            },
        ],
        history: hasHistory
            ? [
                  {
                      extId: 'E-1',
                      fromStatus: 'Open',
                      toStatus: 'WIP',
                      changedOn: new Date('2026-04-05'),
                      changedByEmail: 'alice@example.com',
                  },
              ]
            : [],
    };
}

describe('ExcelAdapter', () => {
    it('reports sourceType = excel', () => {
        const a = new ExcelAdapter({ id: 1, name: 'x', laneConfig }, async () => src(true));
        expect(a.sourceType).toBe('excel');
    });

    it('normalizes rows, resolves lanes, and attaches history when available', async () => {
        const a = new ExcelAdapter({ id: 1, name: 'x', laneConfig }, async () => src(true));
        const issues = await a.getIssues({});
        expect(issues).toHaveLength(2);
        const e1 = issues.find(i => i.extId === 'E-1')!;
        expect(e1.semanticLane).toBe('in_progress');
        expect(e1.fidelity).toBe('full');
        expect(e1.statusHistory).toHaveLength(1);
        expect(e1.statusHistory[0].to).toBe('WIP');
    });

    it('falls back to statusChangedOn when no History sheet (approximate fidelity)', async () => {
        const a = new ExcelAdapter({ id: 1, name: 'x', laneConfig }, async () => src(false));
        const issues = await a.getIssues({});
        const e1 = issues.find(i => i.extId === 'E-1')!;
        expect(e1.fidelity).toBe('approximate');
        expect(e1.statusHistory).toHaveLength(1);
        expect(e1.statusHistory[0].to).toBe('WIP');
        const e2 = issues.find(i => i.extId === 'E-2')!;
        expect(e2.statusHistory).toHaveLength(0);
    });

    it('filters by window fromDate on updatedAt', async () => {
        const a = new ExcelAdapter({ id: 1, name: 'x', laneConfig }, async () => src(false));
        const issues = await a.getIssues({ fromDate: new Date('2026-04-09') });
        expect(issues).toHaveLength(1);
        expect(issues[0].extId).toBe('E-2');
    });

    it('lists sprints derived from row.sprintName', async () => {
        const a = new ExcelAdapter({ id: 1, name: 'x', laneConfig }, async () => src(true));
        const sprints = await a.listSprints();
        expect(sprints).toHaveLength(1);
        expect(sprints[0].name).toBe('Sprint 1');
    });

    it('resolveUser matches by assignee email (case-insensitive)', async () => {
        const a = new ExcelAdapter({ id: 1, name: 'x', laneConfig }, async () => src(true));
        const u = await a.resolveUser('ALICE@example.com');
        expect(u?.email).toBe('alice@example.com');
    });

    it('testConnection reports row + history counts', async () => {
        const a = new ExcelAdapter({ id: 1, name: 'x', laneConfig }, async () => src(true));
        const r = await a.testConnection();
        expect(r.ok).toBe(true);
        expect(r.message).toContain('2 rows');
        expect(r.message).toContain('1 history');
    });

    it('testConnection fails when no import available', async () => {
        const a = new ExcelAdapter({ id: 1, name: 'x', laneConfig }, async () => null);
        const r = await a.testConnection();
        expect(r.ok).toBe(false);
    });
});
