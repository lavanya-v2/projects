import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { ExcelTicketState } from '../../../../models/ExcelTicketState';
import { ExcelImport } from '../../../../models/ExcelImport';
import { extractHeaders, NO_MAPPING_MESSAGE } from '../../excelTemplateValidator';
import {
  AZURE_HEADERS,
  AZURE_MAPPING,
  AzureRow,
  azureCells,
  buildAzureCsv,
  buildAzureWorkbook,
  buildCsv,
  buildWorkbook,
} from './helpers/fixtureWorkbook';
import { assertScratchDatabase, cleanupProject, importFile, SeededProject, seedProject } from './helpers/seed';

/**
 * Files that are wrong in every way a customer export can be wrong.
 *
 * The bar for each: a clear reason the user can act on, and NOTHING written when validation fails.
 * A partially-applied bad file is worse than a rejected one, because the numbers still move.
 */

let seeded: SeededProject | null = null;

beforeAll(async () => {
  await assertScratchDatabase();
});

afterEach(async () => {
  if (seeded) {
    await cleanupProject(seeded);
    seeded = null;
  }
});

async function newProject(options: Parameters<typeof seedProject>[0] = {}) {
  seeded = await seedProject({ mapping: AZURE_MAPPING, ...options });
  return seeded.project;
}

/** Nothing at all reached the database. */
async function expectNothingWritten(projectId: number) {
  expect(await ExcelImport.count({ where: { projectId } })).toBe(0);
  expect(await ExcelTicketState.count({ where: { projectId } })).toBe(0);
}

const OK_ROW: AzureRow = { id: 'G-1', state: 'Done', effort: 5, iteration: 'Sprint A' };

describe('unreadable files', () => {
  it('rejects a file that is not a spreadsheet, without leaking zip internals', async () => {
    await expect(extractHeaders(Buffer.from('this is plain text'), 'excel')).rejects.toThrow(
      /could not be read as a spreadsheet/i
    );
  });

  it('rejects a workbook with no sheets to read', async () => {
    const project = await newProject();
    // A zero-row workbook still has a sheet; an empty header row is the real-world case.
    const buffer = await buildWorkbook(['', '', ''], []);
    const { validation, imp } = await importFile(project, buffer);

    expect(validation.ok).toBe(false);
    expect(imp).toBeNull();
    await expectNothingWritten(project.id);
  });

  it('accepts a header-only file as a valid but empty import', async () => {
    // Not an error: an empty sprint export is legitimate. It must simply import nothing.
    const project = await newProject();
    const { validation, imp } = await importFile(project, await buildAzureWorkbook([]));

    expect(validation.ok).toBe(true);
    expect(validation.rows).toHaveLength(0);
    expect(imp!.rowCount).toBe(0);
    expect(await ExcelTicketState.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('rejects an empty CSV', async () => {
    const project = await newProject();
    const { validation } = await importFile(project, Buffer.from('', 'utf8'), { fileType: 'csv' });

    expect(validation.ok).toBe(false);
    expect(validation.errors[0].reason).toMatch(/empty/i);
  });
});

describe('missing configuration', () => {
  it('refuses to import for a project with no mapping', async () => {
    const project = await newProject({ mapping: null });
    const { validation, imp } = await importFile(project, await buildAzureWorkbook([OK_ROW]));

    expect(validation.ok).toBe(false);
    expect(validation.errors[0].reason).toBe(NO_MAPPING_MESSAGE);
    expect(imp).toBeNull();
    await expectNothingWritten(project.id);
  });

  it('refuses to import when the mapping is present but entirely blank', async () => {
    const project = await newProject({ mapping: { externalId: '' } });
    const { validation } = await importFile(project, await buildAzureWorkbook([OK_ROW]));

    expect(validation.ok).toBe(false);
    expect(validation.errors[0].reason).toBe(NO_MAPPING_MESSAGE);
  });

  it('rejects a file missing a column the mapping requires', async () => {
    const project = await newProject();
    // Same data, but the ID column is gone.
    const headers = AZURE_HEADERS.filter(h => h !== 'ID');
    const cells = azureCells(OK_ROW).slice(1);
    const { validation, imp } = await importFile(project, await buildWorkbook(headers, [cells]));

    expect(validation.ok).toBe(false);
    expect(validation.errors.some(e => /missing required column/i.test(e.reason))).toBe(true);
    expect(imp).toBeNull();
    await expectNothingWritten(project.id);
  });

  it('rejects the file outright when a MAPPED column is absent', async () => {
    /*
     * The "story points are 0 even though the file has them" class -- and the answer is stricter
     * than importing a blank: every column the project mapped is treated as required, so a mapping
     * pointing at a header the file does not have fails the whole upload by name. Nothing is
     * written, and the reason names the column.
     */
    const project = await newProject({
      mapping: { ...AZURE_MAPPING, storyPoints: 'Story Points' }, // this file calls it 'Effort'
    });

    const { validation, imp } = await importFile(project, await buildAzureWorkbook([OK_ROW]));

    expect(validation.ok).toBe(false);
    expect(validation.errors.some(e => e.reason === 'Missing required column: Story Points')).toBe(true);
    expect(imp).toBeNull();
    await expectNothingWritten(project.id);

    const sp = validation.mappingReport.find(m => m.field === 'storyPoints');
    expect(sp?.matched).toBe(false);
    expect(sp?.mappedHeader).toBe('Story Points');
    expect(sp?.source).toBe('mapping');
  });

  it('imports blank for an UNMAPPED field whose default header is absent', async () => {
    /*
     * The complement: a field nobody mapped falls back to a default header name. That is not
     * required, so the file imports and the field is simply empty -- which is only acceptable
     * because the preflight names it.
     */
    const project = await newProject(); // AZURE_MAPPING has no sprintStartDate

    const { validation, imp } = await importFile(project, await buildAzureWorkbook([OK_ROW]));

    expect(validation.ok).toBe(true);
    expect(validation.rows[0].sprintStart).toBeUndefined();
    expect(imp).not.toBeNull();

    const start = validation.mappingReport.find(m => m.field === 'sprintStartDate');
    expect(start?.matched).toBe(false);
    expect(start?.source).toBe('none');

    const [state] = await ExcelTicketState.findAll({ where: { projectId: project.id } });
    expect(state.sprintStart ?? null).toBeNull();
  });
});

describe('bad row data', () => {
  it('rejects duplicate external IDs within one file', async () => {
    const project = await newProject();
    const { validation, imp } = await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'DUP-1', effort: 5, iteration: 'Sprint A' },
        { id: 'DUP-1', effort: 3, iteration: 'Sprint A' },
      ])
    );

    expect(validation.ok).toBe(false);
    expect(validation.errors.some(e => /duplicate external id/i.test(e.reason))).toBe(true);
    expect(imp).toBeNull();
    await expectNothingWritten(project.id);
  });

  it('rejects rows missing a required value', async () => {
    const project = await newProject();
    const { validation } = await importFile(
      project,
      await buildAzureWorkbook([
        { id: '', title: 'No id', effort: 1, iteration: 'Sprint A' },
        { id: 'R-2', title: '', effort: 1, iteration: 'Sprint A' },
        { id: 'R-3', state: '', effort: 1, iteration: 'Sprint A' },
      ])
    );

    expect(validation.ok).toBe(false);
    const columns = validation.errors.map(e => e.column);
    expect(columns).toContain('External ID');
    expect(columns).toContain('Title');
    expect(columns).toContain('Status');
  });

  it('rejects a non-numeric estimate in strict mode and coerces it in best-effort', async () => {
    const project = await newProject();
    const { validation } = await importFile(
      project,
      await buildAzureWorkbook([{ id: 'C-1', effort: '5 points', iteration: 'Sprint A' }])
    );

    // Strict fails, so the parser retries in best-effort and the result records the coercion.
    expect(validation.mode).toBe('best_effort');
    expect(validation.ok).toBe(true);
    expect(validation.rows[0].storyPoints).toBe(5);
    expect(validation.coercions.some(c => c.column === 'Story Points')).toBe(true);
  });

  it('imports an unreadable estimate as blank, and records why', async () => {
    /*
     * Not an error: the row is still real work, and dropping the whole file over one bad cell would
     * be worse. But the estimate is silently absent from every total unless the coercion is
     * surfaced, so the note is the thing that makes this acceptable.
     */
    const project = await newProject();
    const { validation, imp } = await importFile(
      project,
      await buildAzureWorkbook([{ id: 'C-2', effort: 'TBD', iteration: 'Sprint A' }])
    );

    expect(validation.ok).toBe(true);
    expect(validation.mode).toBe('best_effort');
    expect(validation.rows[0].storyPoints).toBeUndefined();

    const note = validation.coercions.find(c => c.column === 'Story Points');
    expect(note?.original).toBe('TBD');
    expect(note?.coerced).toBeNull();
    expect(note?.reason).toMatch(/could not read as a number/i);

    expect(imp!.rowCount).toBe(1);
  });

  it('downgrades the WHOLE file to best-effort over a single bad cell', async () => {
    /*
     * Documented rather than endorsed. Strict is attempted for the entire sheet and, on any failure,
     * the whole sheet is re-parsed leniently -- so one unreadable estimate also relaxes header
     * matching for every other column. Recorded here so a future change to that coupling is a
     * deliberate decision rather than an accident.
     */
    const project = await newProject();
    const { validation } = await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'OK-1', effort: 5, iteration: 'Sprint A' },
        { id: 'BAD-1', effort: 'TBD', iteration: 'Sprint A' },
      ])
    );

    expect(validation.ok).toBe(true);
    expect(validation.mode).toBe('best_effort');
    // The good row is unaffected in value terms.
    expect(validation.rows.find(r => r.extId === 'OK-1')!.storyPoints).toBe(5);
  });

  it('aliases an unfamiliar work-item type rather than dropping the row', async () => {
    const project = await newProject();
    const { validation } = await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'T-1', type: 'Product Backlog Item', effort: 1, iteration: 'Sprint A' },
        { id: 'T-2', type: 'Feature', effort: 1, iteration: 'Sprint A' },
      ])
    );

    expect(validation.ok).toBe(true);
    expect(validation.rows.map(r => r.type)).toEqual(['Backlog', 'Epic']);
  });

  it('rejects a sprint that ends before it starts', async () => {
    const project = await newProject({
      mapping: { ...AZURE_MAPPING, sprintStartDate: 'Created Date', sprintEndDate: 'Changed Date' },
    });

    const { validation, imp } = await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'W-1', effort: 1, iteration: 'Sprint A', created: '2026-03-20', changed: '2026-03-01' },
      ])
    );

    expect(validation.ok).toBe(false);
    expect(validation.errors.some(e => /sprint start is after sprint end/i.test(e.reason))).toBe(true);
    expect(imp).toBeNull();
  });
});

describe('sprint requirements', () => {
  it('rejects rows with no sprint when the project reports by sprint', async () => {
    const project = await newProject({ reportingFrequency: 'sprint' });
    const { validation, imp } = await importFile(
      project,
      await buildAzureWorkbook([{ id: 'NS-1', effort: 5, iteration: '' }])
    );

    expect(validation.ok).toBe(false);
    expect(validation.errors.some(e => e.column === 'Sprint Name')).toBe(true);
    expect(imp).toBeNull();
    await expectNothingWritten(project.id);
  });

  it('fills only the rows that have no sprint of their own', async () => {
    const project = await newProject({ reportingFrequency: 'sprint' });
    const { validation } = await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'MX-1', effort: 1, iteration: 'Named Sprint' },
        { id: 'MX-2', effort: 1, iteration: '' },
      ]),
      { defaultSprintName: 'Declared Sprint' }
    );

    expect(validation.ok).toBe(true);
    // The file always wins; the form value is a fallback, not an override.
    expect(validation.rows.find(r => r.extId === 'MX-1')!.sprintName).toBe('Named Sprint');
    expect(validation.rows.find(r => r.extId === 'MX-2')!.sprintName).toBe('Declared Sprint');
  });

  it('measures sprint coverage from the file, before the declared sprint is applied', async () => {
    const project = await newProject({ reportingFrequency: 'sprint' });
    const { validation } = await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'CV-1', effort: 1, iteration: 'Sprint A' },
        { id: 'CV-2', effort: 1, iteration: 'Sprint A' },
        { id: 'CV-3', effort: 1, iteration: 'Sprint B' },
        { id: 'CV-4', effort: 1, iteration: '' },
      ]),
      { defaultSprintName: 'Declared Sprint' }
    );

    const coverage = validation.sprintCoverage;
    expect(coverage.rowsWithSprint).toBe(3);
    expect(coverage.rowsMissingSprint).toBe(1);
    expect(coverage.declaredSprintApplied).toBe(true);
    expect(coverage.sprintsInFile).toEqual([
      { sprintName: 'Sprint A', rows: 2 },
      { sprintName: 'Sprint B', rows: 1 },
    ]);
  });

  it('reports full coverage for a file that names a sprint on every row', async () => {
    // This is what makes the upload form stop demanding a sprint that the file already supplies.
    const project = await newProject({ reportingFrequency: 'sprint' });
    const { validation } = await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'FC-1', effort: 1, iteration: 'Sprint A' },
        { id: 'FC-2', effort: 1, iteration: 'Sprint B' },
      ])
    );

    expect(validation.ok).toBe(true);
    expect(validation.sprintCoverage.rowsMissingSprint).toBe(0);
    expect(validation.sprintCoverage.declaredSprintApplied).toBe(false);
  });

  it('allows a daily project to import rows with no sprint', async () => {
    const project = await newProject({ reportingFrequency: 'daily' });
    const { validation, imp } = await importFile(
      project,
      await buildAzureWorkbook([{ id: 'DL-1', effort: 5, iteration: '' }]),
      { reportDate: '2026-03-01' }
    );

    expect(validation.ok).toBe(true);
    expect(imp!.rowCount).toBe(1);
  });
});

describe('CSV parity', () => {
  const ROWS: AzureRow[] = [
    { id: 'P-1', type: 'Bug', state: 'Done', effort: 5, assignee: 'a@x.com', iteration: 'Sprint A' },
    { id: 'P-2', type: 'Product Backlog Item', state: 'New', effort: 3, assignee: '', iteration: 'Sprint A' },
  ];

  it('produces the same rows from CSV as from XLSX', async () => {
    const xlsxProject = await newProject();
    const fromXlsx = await importFile(xlsxProject, await buildAzureWorkbook(ROWS));
    await cleanupProject(seeded!);
    seeded = null;

    const csvProject = await newProject();
    const fromCsv = await importFile(csvProject, buildAzureCsv(ROWS), { fileType: 'csv' });

    const shape = (v: typeof fromXlsx.validation) =>
      v.rows.map(r => ({
        extId: r.extId,
        type: r.type,
        status: r.status,
        storyPoints: r.storyPoints,
        assigneeEmail: r.assigneeEmail,
        sprintName: r.sprintName,
      }));

    expect(fromCsv.validation.ok).toBe(true);
    expect(shape(fromCsv.validation)).toEqual(shape(fromXlsx.validation));
  });

  it('rejects a CSV missing a required column, like XLSX does', async () => {
    const project = await newProject();
    const headers = AZURE_HEADERS.filter(h => h !== 'ID');
    const csv = buildCsv(headers, [azureCells(ROWS[0]).slice(1)]);

    const { validation } = await importFile(project, csv, { fileType: 'csv' });
    expect(validation.ok).toBe(false);
  });
});
