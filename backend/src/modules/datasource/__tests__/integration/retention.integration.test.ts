import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ExcelImport } from '../../../../models/ExcelImport';
import { checksumOf, importFilePath, readStoredFile, storeImportFile } from '../../excelFileStore';
import { isContainerType } from '../../../reports/services/excelSprintBoardService';
import { ExcelWorkItem } from '../../../../models/ExcelWorkItem';
import { AZURE_MAPPING, AzureRow, buildAzureWorkbook } from './helpers/fixtureWorkbook';
import { assertScratchDatabase, cleanupProject, importFile, SeededProject, seedProject } from './helpers/seed';

/**
 * Retention of the uploaded file, and the row-level view of what an import actually contained.
 *
 * Both exist because the original complaint was "we can't see the data uploaded" -- neither the file
 * nor its rows were visible anywhere once an upload finished.
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

describe('retaining the uploaded file', () => {
  it('stores the bytes exactly as uploaded', async () => {
    const project = await newProject();
    const buffer = await buildAzureWorkbook([{ id: 'R-1', effort: 5, iteration: 'Sprint A' }]);
    const { imp } = await importFile(project, buffer);

    const stored = storeImportFile(project.id, imp!.id, buffer, 'upload.xlsx');
    await imp!.update(stored);

    expect(stored.fileSize).toBe(buffer.length);
    expect(stored.checksum).toBe(checksumOf(buffer));

    const readBack = readStoredFile(stored.storagePath);
    expect(readBack).not.toBeNull();
    // Byte-identical, so a download gives back precisely what was submitted.
    expect(Buffer.compare(readBack!, buffer)).toBe(0);
  });

  it('keys each import’s file separately, so same-day uploads cannot overwrite each other', async () => {
    /*
     * The original defect: every upload wrote to one path per project after wiping the folder, so
     * only the newest file survived. That is the direct cause of "files uploaded for the same date
     * get overwritten".
     */
    const project = await newProject();

    const first = await buildAzureWorkbook([{ id: 'D-1', effort: 5, iteration: 'Sprint A' }]);
    const second = await buildAzureWorkbook([{ id: 'D-2', effort: 3, iteration: 'Sprint A' }]);

    const a = await importFile(project, first, { reportDate: '2026-03-01' });
    const b = await importFile(project, second, { reportDate: '2026-03-01' });

    const storedA = storeImportFile(project.id, a.imp!.id, first, 'monday.xlsx');
    const storedB = storeImportFile(project.id, b.imp!.id, second, 'monday.xlsx');

    expect(storedA.storagePath).not.toBe(storedB.storagePath);
    expect(fs.existsSync(storedA.storagePath)).toBe(true);
    expect(fs.existsSync(storedB.storagePath)).toBe(true);
    expect(Buffer.compare(readStoredFile(storedA.storagePath)!, first)).toBe(0);
  });

  it('detects a re-upload of identical bytes by checksum', async () => {
    const project = await newProject();
    const buffer = await buildAzureWorkbook([{ id: 'C-1', effort: 5, iteration: 'Sprint A' }]);

    const first = await importFile(project, buffer);
    await first.imp!.update(storeImportFile(project.id, first.imp!.id, buffer, 'same.xlsx'));

    const duplicate = await ExcelImport.findOne({
      where: { projectId: project.id, checksum: checksumOf(buffer), status: 'applied' },
    });

    expect(duplicate).not.toBeNull();
    expect(duplicate!.id).toBe(first.imp!.id);
  });

  it('keeps the import when the file cannot be retained', async () => {
    /*
     * Retention is best-effort by design: a filesystem problem must never destroy an otherwise-valid
     * import. What it must NOT do is hide the reason, which is what a generic message used to do.
     */
    const project = await newProject();
    const buffer = await buildAzureWorkbook([{ id: 'F-1', effort: 5, iteration: 'Sprint A' }]);
    const { imp } = await importFile(project, buffer);

    let cause = '';
    try {
      // A path that cannot be created, standing in for an unwritable upload volume.
      storeImportFile(project.id, imp!.id, buffer, 'x.xlsx');
      const blocked = path.join('/proc/definitely-not-writable', 'nope.xlsx');
      fs.mkdirSync(path.dirname(blocked), { recursive: true });
      fs.writeFileSync(blocked, buffer);
    } catch (e) {
      cause = e instanceof Error ? e.message : String(e);
    }

    expect(cause).not.toBe('');

    await imp!.update({
      errorMessage: `Imported successfully, but the original file could not be retained: ${cause}`,
    });
    await imp!.reload();

    expect(imp!.status).toBe('applied');
    expect(imp!.rowCount).toBe(1);
    // The reason survives, so the failure is diagnosable after the fact.
    expect(imp!.errorMessage).toMatch(/could not be retained: /);
    expect(imp!.errorMessage!.length).toBeGreaterThan('Imported successfully, but the original file could not be retained: '.length);
  });

  it('reports a missing file rather than pretending it is there', async () => {
    const project = await newProject();
    const { imp } = await importFile(project, await buildAzureWorkbook([{ id: 'M-1', effort: 1 }]));

    // An import from before retention existed: applied, but with nothing on disk.
    expect(imp!.storagePath ?? null).toBeNull();
    expect(readStoredFile(imp!.storagePath)).toBeNull();
    expect(readStoredFile(importFilePath(project.id, 999999))).toBeNull();
  });
});

describe('the row-level view of an import', () => {
  /*
   * E-1 is a container. It must still be LISTED -- the import is shown in full -- while being
   * excluded from the metrics. Showing 3 rows for a 4-row file would look like data loss.
   */
  const ROWS: AzureRow[] = [
    { id: 'E-1', type: 'Feature', state: 'Active', effort: null, iteration: 'Sprint A' },
    { id: 'W-1', type: 'Product Backlog Item', state: 'Done', effort: 5, parent: 'E-1', iteration: 'Sprint A' },
    { id: 'W-2', type: 'Bug', state: 'New', effort: 3, parent: 'E-1', iteration: 'Sprint A' },
    { id: 'W-3', type: 'Bug', state: 'Done', effort: 2, iteration: 'Sprint A' },
  ];

  it('records every row of the file in the ledger, containers included', async () => {
    const project = await newProject();
    const { imp } = await importFile(project, await buildAzureWorkbook(ROWS));

    const rows = await ExcelWorkItem.findAll({ where: { importId: imp!.id }, order: [['extId', 'ASC']] });

    expect(rows).toHaveLength(4);
    expect(rows.map(r => r.extId)).toEqual(['E-1', 'W-1', 'W-2', 'W-3']);
    expect(imp!.rowCount).toBe(4);
  });

  it('flags exactly the rows the metrics leave out', async () => {
    const project = await newProject();
    const { imp } = await importFile(project, await buildAzureWorkbook(ROWS));

    const rows = await ExcelWorkItem.findAll({ where: { importId: imp!.id } });
    const parentIds = new Set(rows.map(r => (r.parentExtId ?? '').trim()).filter(Boolean));

    const flagged = rows
      .filter(r => isContainerType(r.type) && parentIds.has(r.extId.trim()))
      .map(r => r.extId);

    expect(flagged).toEqual(['E-1']);
  });

  it('keeps the parent link so the container rule has something to work from', async () => {
    const project = await newProject();
    const { imp } = await importFile(project, await buildAzureWorkbook(ROWS));

    const rows = await ExcelWorkItem.findAll({ where: { importId: imp!.id } });
    const byId = new Map(rows.map(r => [r.extId, r]));

    expect(byId.get('W-1')!.parentExtId).toBe('E-1');
    expect(byId.get('W-3')!.parentExtId ?? null).toBeNull();
  });

  it('records the validation report against the import', async () => {
    const project = await newProject();
    const { imp } = await importFile(
      project,
      await buildAzureWorkbook([{ id: 'V-1', effort: '5 pts', iteration: 'Sprint A' }])
    );

    const report = imp!.validationReport as { coercions?: unknown[]; errors?: unknown[] };

    expect(report.errors).toEqual([]);
    expect(report.coercions!.length).toBeGreaterThan(0);
    expect(imp!.mode).toBe('best_effort');
  });
});

describe('resubmitting a retained file', () => {
  it('re-parses under the mapping in force at the time of resubmission', async () => {
    /*
     * The remedy after fixing a bad mapping: the file is still on disk, so it can be run again
     * without asking the user to find it. The new parse must reflect the CURRENT mapping.
     */
    const project = await newProject({
      // Story points deliberately unmapped, so the first import carries none.
      mapping: Object.fromEntries(Object.entries(AZURE_MAPPING).filter(([k]) => k !== 'storyPoints')),
    });

    const buffer = await buildAzureWorkbook([{ id: 'RS-1', state: 'Done', effort: 5, iteration: 'Sprint A' }]);
    const { imp } = await importFile(project, buffer);
    await imp!.update(storeImportFile(project.id, imp!.id, buffer, 'resubmit.xlsx'));

    const { excelSprintBoardService } = await import('../../../reports/services/excelSprintBoardService');
    expect((await excelSprintBoardService.getScorecard(project.id, 'Sprint A')).totals.finalScopeSp).toBe(0);

    // Fix the mapping, then re-run the retained bytes.
    const { saveMappingVersion } = await import('./helpers/seed');
    await saveMappingVersion(project, AZURE_MAPPING);
    await project.reload();

    const retained = readStoredFile(imp!.storagePath);
    expect(retained).not.toBeNull();

    await importFile(project, retained!, { conflictStrategy: 'merge' });

    const sc = await excelSprintBoardService.getScorecard(project.id, 'Sprint A');
    expect(sc.totals.finalScopeSp).toBe(5);
    expect(sc.totals.ticketCount).toBe(1);
  });
});
