import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';

// Lets the custom-mapping path be exercised without a database.
const mappingRow = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('../../../models/TemplateMapping', () => ({
    TemplateMapping: { findOne: async () => mappingRow.current },
}));

// The logger barrel pulls in Sequelize models, whose decorators cannot be evaluated under the test
// transform. Only the logger itself is needed here.
vi.mock('../../../common/utils', () => ({
    logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
}));

// The AI client is never constructed for real; each test decides what the model "returned".
const aiReply = vi.hoisted(() => ({ text: '{}', throws: false }));
vi.mock('@anthropic-ai/sdk', () => ({
    default: class {
        messages = {
            create: async () => {
                if (aiReply.throws) {
                    throw new Error('anthropic unavailable');
                }
                return { content: [{ text: aiReply.text }] };
            },
        };
    },
}));

import {
    extractHeaders,
    MAPPABLE_FIELDS,
    resolveMappingKey,
    validateExcelBuffer,
} from '../excelTemplateValidator';
import { aiService } from '../../ai/services/aiService';

async function workbookWith(headers: string[], rows: (string | number | Date)[][] = []): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Issues');
    sheet.addRow(headers);
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The Azure DevOps export shape the mapping flow was built against. */
const AZURE_HEADERS = [
    'ID', 'Title', 'Work Item Type', 'State', 'Priority', 'Effort',
    'Assigned To', 'Iteration Path', 'Created Date', 'Changed Date', 'Parent', 'Tags',
];

beforeEach(() => {
    mappingRow.current = null;
    aiReply.text = '{}';
    aiReply.throws = false;
});

describe('extractHeaders', () => {
    it('reads the header row of a workbook', async () => {
        const headers = await extractHeaders(await workbookWith(AZURE_HEADERS), 'excel');
        expect(headers).toEqual(AZURE_HEADERS);
    });

    it('reads the header row of a CSV', async () => {
        const csv = Buffer.from('Key,Summary,Status\nABC-1,Login,Done\n', 'utf8');
        expect(await extractHeaders(csv, 'csv')).toEqual(['Key', 'Summary', 'Status']);
    });

    it('rejects a file that is not a spreadsheet without leaking zip internals', async () => {
        // The raw reader says "Can't find end of central directory" and links to its own docs,
        // which tells someone who picked the wrong file nothing they can act on.
        await expect(extractHeaders(Buffer.from('not a spreadsheet'), 'excel')).rejects.toThrow(
            /could not be read as a spreadsheet/i,
        );
    });

    it('rejects a sheet whose first row is blank', async () => {
        await expect(extractHeaders(await workbookWith(['', '', '']), 'excel')).rejects.toThrow(
            /no column headers/i,
        );
    });
});

describe('resolveMappingKey', () => {
    it('accepts the internal key and the human label alike', () => {
        expect(resolveMappingKey('parentExtId')).toBe('parentExtId');
        expect(resolveMappingKey('Parent / Epic')).toBe('parentExtId');
        expect(resolveMappingKey('  story points ')).toBe('storyPoints');
    });

    it('rejects anything not in the field list', () => {
        // The save endpoint used to camel-case whatever arrived, inventing keys nothing reads --
        // 'Parent / Epic' became 'parent/Epic' and the mapping was stored where no reader looks.
        expect(resolveMappingKey('parent/Epic')).toBeUndefined();
        expect(resolveMappingKey('bogusField')).toBeUndefined();
    });
});

describe('suggestColumnMapping', () => {
    it('returns the model draft when every value is a real header', async () => {
        aiReply.text = JSON.stringify({
            externalId: 'ID',
            storyPoints: 'Effort',
            sprintName: 'Iteration Path',
            parentExtId: 'Parent',
        });

        const result = await aiService.suggestColumnMapping(AZURE_HEADERS, MAPPABLE_FIELDS);

        expect(result).toEqual({
            externalId: 'ID',
            storyPoints: 'Effort',
            sprintName: 'Iteration Path',
            parentExtId: 'Parent',
        });
    });

    it('drops a header the file does not actually have', async () => {
        // A hallucinated header would be stored as a mapping that matches no column, and every row
        // would import blank for that field -- the exact shape of the "story points are 0" bug.
        aiReply.text = JSON.stringify({ externalId: 'ID', storyPoints: 'Story Points' });

        expect(await aiService.suggestColumnMapping(AZURE_HEADERS, MAPPABLE_FIELDS)).toEqual({
            externalId: 'ID',
        });
    });

    it('drops a field that is not mappable', async () => {
        aiReply.text = JSON.stringify({ externalId: 'ID', madeUpField: 'Tags' });

        expect(await aiService.suggestColumnMapping(AZURE_HEADERS, MAPPABLE_FIELDS)).toEqual({
            externalId: 'ID',
        });
    });

    it('tolerates a fenced or prose-wrapped reply', async () => {
        aiReply.text = 'Here you go:\n```json\n{"externalId":"ID"}\n```';

        expect(await aiService.suggestColumnMapping(AZURE_HEADERS, MAPPABLE_FIELDS)).toEqual({
            externalId: 'ID',
        });
    });

    it('degrades to an empty draft when the model is unavailable', async () => {
        // Suggestions are a convenience; losing them must never block mapping by hand.
        aiReply.throws = true;

        expect(await aiService.suggestColumnMapping(AZURE_HEADERS, MAPPABLE_FIELDS)).toEqual({});
    });

    it('returns nothing for a file with no headers', async () => {
        expect(await aiService.suggestColumnMapping([], MAPPABLE_FIELDS)).toEqual({});
    });
});

describe('custom mapping rows carry non-mapping columns', () => {
    it('ignores the retained sample file when deciding which columns a file must have', async () => {
        /*
         * template_mappings also holds the sample file's path, size and header list. Those were
         * once read as part of the header map, so `requiredHeadersFor` demanded a column named
         * after the storage path and every upload failed validation.
         */
        mappingRow.current = {
            externalId: 'ID',
            title: 'Title',
            status: 'State',
            createdDate: 'Created Date',
            lastUpdated: 'Changed Date',
            type: 'Work Item Type',
            storagePath: '/uploads/projects/39/mapping/8.xlsx',
            originalFilename: 'sample.xlsx',
            checksum: 'abc123',
            sourceHeaders: AZURE_HEADERS,
            version: 1,
        };

        const buffer = await workbookWith(AZURE_HEADERS, [
            ['ID-1', 'Login page', 'Bug', 'Active', 'P2', 3, 'a@b.com', 'Sprint 34',
                new Date('2026-01-05'), new Date('2026-01-09'), '', ''],
        ]);

        const result = await validateExcelBuffer(buffer, '39' as never, { defaultSprintName: 'Sprint 34' });

        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);
        expect(result.rows).toHaveLength(1);
    });

    it('reports no mapping when every mapped column is blank', async () => {
        mappingRow.current = { externalId: null, title: '', storagePath: '/uploads/x.xlsx', version: 2 };

        const result = await validateExcelBuffer(await workbookWith(AZURE_HEADERS), '39' as never);

        expect(result.ok).toBe(false);
        expect(result.errors[0].reason).toMatch(/no column mapping/i);
    });
});
