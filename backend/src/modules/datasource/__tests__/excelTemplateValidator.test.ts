import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { validateExcelBuffer } from '../excelTemplateValidator';

// Lets the custom-mapping path be exercised without a database.
const mappingRow = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('../../../models/TemplateMapping', () => ({
    TemplateMapping: { findOne: async () => mappingRow.current },
}));

async function buildWorkbook(
    rows: (string | number | Date)[][],
    headers: string[],
    historyRows?: (string | number | Date)[][],
): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const issues = wb.addWorksheet('Issues');
    issues.addRow(headers);
    for (const r of rows) issues.addRow(r);

    if (historyRows) {
        const h = wb.addWorksheet('Status History');
        h.addRow(['External ID', 'From Status', 'To Status', 'Changed On', 'Changed By']);
        for (const r of historyRows) h.addRow(r);
    }

    const ab = await wb.xlsx.writeBuffer();
    return Buffer.from(ab as ArrayBuffer);
}

const SCRUM_HEADERS = [
    'External ID',
    'Title',
    'Type',
    'Status',
    'Priority',
    'Assignee Email',
    'Story Points',
    'Sprint Name',
    'Sprint Start Date',
    'Sprint End Date',
    'Created Date',
    'Last Updated',
];

const goodRow = (id: string) => [
    id,
    `Title ${id}`,
    'Story',
    'In Progress',
    'High',
    'alice@example.com',
    3,
    'Sprint 10',
    new Date('2026-04-01'),
    new Date('2026-04-14'),
    new Date('2026-04-02'),
    new Date('2026-04-10'),
];

describe('validateExcelBuffer — strict pass', () => {
    it('accepts a well-formed scrum workbook', async () => {
        const buf = await buildWorkbook([goodRow('A-1'), goodRow('A-2')], SCRUM_HEADERS);
        const r = await validateExcelBuffer(buf, 'scrum');
        expect(r.ok).toBe(true);
        expect(r.mode).toBe('strict');
        expect(r.rows).toHaveLength(2);
        expect(r.errors).toHaveLength(0);
        expect(r.rows[0].extId).toBe('A-1');
        expect(r.rows[0].createdAt).toBeInstanceOf(Date);
    });

    it('parses History sheet when present', async () => {
        const buf = await buildWorkbook(
            [goodRow('A-1')],
            SCRUM_HEADERS,
            [['A-1', 'To Do', 'In Progress', new Date('2026-04-05'), 'alice@example.com']],
        );
        const r = await validateExcelBuffer(buf, 'scrum');
        expect(r.ok).toBe(true);
        expect(r.history).toHaveLength(1);
        expect(r.history[0]).toMatchObject({
            extId: 'A-1',
            fromStatus: 'To Do',
            toStatus: 'In Progress',
        });
    });
});

describe('validateExcelBuffer — strict failures', () => {
    it('rejects missing required column', async () => {
        const missingTitle = SCRUM_HEADERS.filter(h => h !== 'Title');
        const row = goodRow('A-1');
        row.splice(1, 1);
        const buf = await buildWorkbook([row], missingTitle);
        const r = await validateExcelBuffer(buf, 'scrum');
        expect(r.ok).toBe(false);
        expect(r.errors.some(e => e.reason.includes('Missing required column: Title'))).toBe(true);
    });

    it('rejects duplicate External IDs', async () => {
        const buf = await buildWorkbook([goodRow('A-1'), goodRow('A-1')], SCRUM_HEADERS);
        const r = await validateExcelBuffer(buf, 'scrum');
        expect(r.ok).toBe(false);
        expect(r.errors.some(e => e.reason.includes('Duplicate External ID'))).toBe(true);
    });

    it('rejects invalid type in strict mode', async () => {
        const row = goodRow('A-1');
        row[2] = 'defect'; // lowercase variant — only valid in best-effort
        const buf = await buildWorkbook([row], SCRUM_HEADERS);
        const r = await validateExcelBuffer(buf, 'scrum');
        // Strict fails; validator automatically retries in best-effort and succeeds
        expect(r.mode).toBe('best_effort');
        expect(r.ok).toBe(true);
        expect(r.coercions.some(c => c.column === 'Type' && c.coerced === 'Bug')).toBe(true);
        expect(r.rows[0].type).toBe('Bug');
    });
});

describe('validateExcelBuffer — best-effort fallback', () => {
    it('matches headers case-insensitively and records coercion', async () => {
        const lower = SCRUM_HEADERS.map(h => h.toLowerCase());
        const buf = await buildWorkbook([goodRow('A-1')], lower);
        const r = await validateExcelBuffer(buf, 'scrum');
        expect(r.mode).toBe('best_effort');
        expect(r.ok).toBe(true);
        expect(
            r.coercions.filter(c => c.reason.includes('leniently')).length,
        ).toBeGreaterThan(0);
    });

    it('fuzzy-maps type aliases', async () => {
        const row = goodRow('A-1');
        row[2] = 'User Story';
        const buf = await buildWorkbook([row], SCRUM_HEADERS);
        const r = await validateExcelBuffer(buf, 'scrum');
        expect(r.ok).toBe(true);
        expect(r.mode).toBe('best_effort');
        expect(r.rows[0].type).toBe('Story');
    });
});

describe('validateExcelBuffer — story points', () => {
    const spIndex = SCRUM_HEADERS.indexOf('Story Points');

    const rowWithSp = (id: string, sp: string | number) => {
        const row = goodRow(id);
        row[spIndex] = sp;
        return row;
    };

    it('reads story points when the file uses the canonical header', async () => {
        const buf = await buildWorkbook([rowWithSp('A-1', 8)], SCRUM_HEADERS);
        const r = await validateExcelBuffer(buf, 'scrum');
        expect(r.ok).toBe(true);
        expect(r.rows[0].storyPoints).toBe(8);
    });

    it('coerces unit-suffixed and comma-decimal values in best effort', async () => {
        const buf = await buildWorkbook([rowWithSp('A-1', '5 SP'), rowWithSp('A-2', '3,5')], SCRUM_HEADERS);
        const r = await validateExcelBuffer(buf, 'scrum');
        expect(r.mode).toBe('best_effort');
        expect(r.ok).toBe(true);
        expect(r.rows.map(x => x.storyPoints)).toEqual([5, 3.5]);
    });

    it('imports an unreadable story point as blank rather than failing the upload', async () => {
        const buf = await buildWorkbook([rowWithSp('A-1', '-')], SCRUM_HEADERS);
        const r = await validateExcelBuffer(buf, 'scrum');
        expect(r.ok).toBe(true);
        expect(r.rows[0].storyPoints).toBeUndefined();
        expect(r.coercions.some(c => c.column === 'Story Points' && c.coerced === null)).toBe(true);
    });
});

describe('validateExcelBuffer — custom column mapping', () => {
    const CUSTOM_HEADERS = [
        'Issue id',
        'Summary',
        'Type',
        'State',
        'Assignee Email',
        'Estimation - SP',
        'Sprint',
        'Sprint Start Date',
        'Sprint End Date',
        'Created Date',
        'Last Updated',
    ];

    const customRow = (id: string, sp: number) => [
        id,
        `Title ${id}`,
        'Story',
        'In Progress',
        'alice@example.com',
        sp,
        'Sprint 10',
        new Date('2026-04-01'),
        new Date('2026-04-14'),
        new Date('2026-04-02'),
        new Date('2026-04-10'),
    ];

    const baseMapping = {
        externalId: 'Issue id',
        title: 'Summary',
        type: 'Type',
        status: 'State',
        assigneeEmail: 'Assignee Email',
        sprintName: 'Sprint',
        sprintStartDate: 'Sprint Start Date',
        sprintEndDate: 'Sprint End Date',
        createdDate: 'Created Date',
        lastUpdated: 'Last Updated',
    };

    it('reads story points through the mapped header', async () => {
        mappingRow.current = { ...baseMapping, storyPoints: 'Estimation - SP' };
        const buf = await buildWorkbook([customRow('C-1', 13)], CUSTOM_HEADERS);
        const r = await validateExcelBuffer(buf, '42' as never);
        expect(r.ok).toBe(true);
        expect(r.rows[0].storyPoints).toBe(13);
        expect(r.mappingReport.find(m => m.field === 'storyPoints')).toMatchObject({
            mappedHeader: 'Estimation - SP',
            matched: true,
            source: 'mapping',
        });
    });

    // Regression: optional mapping columns defaulted to '', and the old resolver used `??`, which
    // does not fall back on the empty string. A blank mapping therefore resolved to the EMPTY
    // header, missed the header index and silently imported as blank -- reported by users as
    // "SP is 0 even though the file has Estimation - SP".
    it('falls back to the canonical header when a mapping value is blank', async () => {
        mappingRow.current = { ...baseMapping, storyPoints: '' };
        const headers = CUSTOM_HEADERS.map(h => (h === 'Estimation - SP' ? 'Story Points' : h));
        const buf = await buildWorkbook([customRow('C-1', 13)], headers);
        const r = await validateExcelBuffer(buf, '42' as never);

        expect(r.ok).toBe(true);
        // Under the old `??` resolver this was undefined.
        expect(r.rows[0].storyPoints).toBe(13);
        expect(r.mappingReport.find(m => m.field === 'storyPoints')).toMatchObject({
            mappedHeader: undefined,
            usedHeader: 'Story Points',
            matched: true,
            source: 'default',
        });
    });

    // The preflight is the user-facing half of the fix: a mapped header that is not in the file is
    // reported before upload rather than silently producing blanks.
    it('reports a mapped header that is missing from the file', async () => {
        mappingRow.current = { ...baseMapping, storyPoints: 'Estimation - SP' };
        const headers = CUSTOM_HEADERS.map(h => (h === 'Estimation - SP' ? 'Points' : h));
        const buf = await buildWorkbook([customRow('C-1', 13)], headers);
        const r = await validateExcelBuffer(buf, '42' as never);

        expect(r.mappingReport.find(m => m.field === 'storyPoints')).toMatchObject({
            mappedHeader: 'Estimation - SP',
            matched: false,
            source: 'mapping',
        });
    });

    it('fails clearly when the project has no mapping at all', async () => {
        mappingRow.current = null;
        const buf = await buildWorkbook([customRow('C-1', 13)], CUSTOM_HEADERS);
        const r = await validateExcelBuffer(buf, '42' as never);
        expect(r.ok).toBe(false);
        expect(r.errors[0].reason).toContain('no column mapping configured');
    });
});

describe('validateExcelBuffer — sprint identity', () => {
    const NO_SPRINT_HEADERS = SCRUM_HEADERS.filter(
        h => !['Sprint Name', 'Sprint Start Date', 'Sprint End Date'].includes(h),
    );

    const rowWithoutSprint = (id: string) => {
        const row = goodRow(id);
        return row.filter((_, i) => ![7, 8, 9].includes(i));
    };

    it('rejects a sprint-based project when nothing supplies a sprint', async () => {
        const buf = await buildWorkbook([rowWithoutSprint('A-1')], NO_SPRINT_HEADERS);
        const r = await validateExcelBuffer(buf, 'scrum', { requireSprint: true });
        expect(r.ok).toBe(false);
    });

    // Customer exports frequently carry no Sprint column at all; the uploader names the sprint
    // instead. This must not be rejected for a missing Sprint column.
    it('accepts a file with no sprint columns when the uploader declares one', async () => {
        const buf = await buildWorkbook([rowWithoutSprint('A-1'), rowWithoutSprint('A-2')], NO_SPRINT_HEADERS);
        const r = await validateExcelBuffer(buf, 'scrum', {
            requireSprint: true,
            defaultSprintName: 'Sprint 42',
        });
        expect(r.ok).toBe(true);
        expect(r.rows.map(x => x.sprintName)).toEqual(['Sprint 42', 'Sprint 42']);
    });

    it('lets a sprint value in the file win over the declared one', async () => {
        const buf = await buildWorkbook([goodRow('A-1')], SCRUM_HEADERS);
        const r = await validateExcelBuffer(buf, 'scrum', { defaultSprintName: 'Sprint 42' });
        expect(r.ok).toBe(true);
        expect(r.rows[0].sprintName).toBe('Sprint 10');
    });

    // The old behaviour stamped "Custom Sprint - <upload time>" onto such rows, minting a new sprint
    // on every upload so the same sprint could never be re-uploaded and merged.
    it('does not invent a timestamped sprint name', async () => {
        const buf = await buildWorkbook([rowWithoutSprint('A-1')], NO_SPRINT_HEADERS);
        const r = await validateExcelBuffer(buf, 'scrum', { defaultSprintName: 'Sprint 42' });
        expect(r.rows[0].sprintName).toBe('Sprint 42');
        expect(JSON.stringify(r.rows)).not.toContain('Custom Sprint');
    });
});

describe('validateExcelBuffer — kanban template', () => {
    it('accepts kanban template without sprint columns', async () => {
        const headers = [
            'External ID',
            'Title',
            'Type',
            'Status',
            'Assignee Email',
            'Created Date',
            'Last Updated',
            'Done Date',
        ];
        const rows = [
            [
                'K-1',
                'Kanban Card',
                'Task',
                'Done',
                'alice@example.com',
                new Date('2026-04-01'),
                new Date('2026-04-10'),
                new Date('2026-04-10'),
            ],
        ];
        const buf = await buildWorkbook(rows, headers);
        const r = await validateExcelBuffer(buf, 'kanban');
        expect(r.ok).toBe(true);
        expect(r.rows[0].doneDate).toBeInstanceOf(Date);
    });
});
