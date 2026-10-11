import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'fs';
import { Request, Response } from 'express';
import {
  getProjectMappingTemplateDetails,
  saveProjectMappingTemplate,
} from '../../../admin/controllers/adminController';
import { TemplateMapping } from '../../../../models/TemplateMapping';
import { excelSprintBoardService } from '../../../reports/services/excelSprintBoardService';
import { AZURE_HEADERS, AZURE_MAPPING, AzureRow, buildAzureWorkbook } from './helpers/fixtureWorkbook';
import { assertScratchDatabase, cleanupProject, importFile, SeededProject, seedProject } from './helpers/seed';

/**
 * Mapping versioning, sample retention and the effect a mapping change has on data already imported.
 *
 * Drives the real HTTP handlers rather than the model, because the versioning, the supersede stamp
 * and the sample-file write all live in the controller transaction.
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

interface Captured {
  status: number;
  body: any;
}

/** Minimal express double: the handlers only ever use status().json(). */
function responseDouble(): { res: Response; captured: Captured } {
  const captured: Captured = { status: 200, body: undefined };

  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;

  return { res, captured };
}

async function saveMapping(
  projectId: number,
  body: Record<string, string>,
  file?: { buffer: Buffer; originalname: string }
): Promise<Captured> {
  const { res, captured } = responseDouble();
  const req = { params: { id: String(projectId) }, body, file } as unknown as Request;
  await saveProjectMappingTemplate(req, res);
  return captured;
}

async function fetchMapping(projectId: number): Promise<Captured> {
  const { res, captured } = responseDouble();
  const req = { params: { id: String(projectId) } } as unknown as Request;
  await getProjectMappingTemplateDetails(req, res);
  return captured;
}

const SAMPLE_ROWS: AzureRow[] = [{ id: 'S-1', state: 'Done', effort: 5, iteration: 'Sprint A' }];

describe('creating the first mapping', () => {
  it('stores v1 with the sample file and its header row', async () => {
    seeded = await seedProject({ mapping: null });
    const buffer = await buildAzureWorkbook(SAMPLE_ROWS);

    const result = await saveMapping(seeded.project.id, AZURE_MAPPING, {
      buffer,
      originalname: 'azure-export.xlsx',
    });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);

    const created = result.body.data;
    expect(created.version).toBe(1);
    expect(created.active).toBe(true);
    expect(created.originalFilename).toBe('azure-export.xlsx');
    expect(created.fileSize).toBe(buffer.length);
    expect(created.checksum).toHaveLength(64);
    expect(created.sourceHeaders).toEqual([...AZURE_HEADERS]);

    // Retained on disk, keyed by mapping id so each version keeps its own file.
    expect(fs.existsSync(created.storagePath)).toBe(true);
    expect(fs.readFileSync(created.storagePath).length).toBe(buffer.length);

    await seeded.project.reload();
    expect(seeded.project.templateMappingId).toBe(created.id);
  });

  it('refuses a mapping with no External ID', async () => {
    seeded = await seedProject({ mapping: null });

    const result = await saveMapping(seeded.project.id, { title: 'Title' });

    expect(result.status).toBe(400);
    expect(result.body.message).toMatch(/external id/i);
    expect(await TemplateMapping.count({ where: { projectId: seeded.project.id } })).toBe(0);
  });

  it('drops keys the importer does not recognise, and accepts human labels', async () => {
    seeded = await seedProject({ mapping: null });

    const result = await saveMapping(seeded.project.id, {
      externalId: 'ID',
      'Parent / Epic': 'Parent',
      bogusField: 'Nonsense',
    });

    expect(result.status).toBe(200);
    expect(result.body.data.parentExtId).toBe('Parent');
    expect(result.body.data.bogusField).toBeUndefined();
  });

  it('rejects a sample file it cannot read, without creating a version', async () => {
    seeded = await seedProject({ mapping: null });

    const result = await saveMapping(seeded.project.id, AZURE_MAPPING, {
      buffer: Buffer.from('not a spreadsheet'),
      originalname: 'broken.xlsx',
    });

    expect(result.status).toBe(400);
    expect(result.body.message).toMatch(/could not be read as a spreadsheet/i);
    expect(await TemplateMapping.count({ where: { projectId: seeded.project.id } })).toBe(0);
  });
});

describe('editing an existing mapping', () => {
  it('creates v2 and carries the sample forward when no new file is supplied', async () => {
    seeded = await seedProject({ mapping: null });
    const buffer = await buildAzureWorkbook(SAMPLE_ROWS);

    const v1 = (await saveMapping(seeded.project.id, AZURE_MAPPING, {
      buffer,
      originalname: 'azure-export.xlsx',
    })).body.data;

    await seeded.project.reload();

    // Drop the labels mapping; supply no file, as the edit-without-uploading flow does.
    const { labels: _dropped, ...withoutLabels } = AZURE_MAPPING;
    const v2 = (await saveMapping(seeded.project.id, withoutLabels)).body.data;

    expect(v2.version).toBe(2);
    expect(v2.labels ?? null).toBeNull();
    // This is what makes a mapping editable later without re-uploading the file.
    expect(v2.sourceHeaders).toEqual([...AZURE_HEADERS]);
    expect(v2.originalFilename).toBe('azure-export.xlsx');
    expect(v2.storagePath).toBe(v1.storagePath);

    const previous = await TemplateMapping.findByPk(v1.id);
    expect(previous!.active).toBe(false);
    expect(previous!.supersededAt).not.toBeNull();
  });

  it('keeps each version’s own sample when the file is replaced', async () => {
    seeded = await seedProject({ mapping: null });

    const first = await buildAzureWorkbook(SAMPLE_ROWS);
    const v1 = (await saveMapping(seeded.project.id, AZURE_MAPPING, {
      buffer: first,
      originalname: 'first.xlsx',
    })).body.data;

    await seeded.project.reload();

    // A different export vocabulary entirely.
    const jiraHeaders = ['Key', 'Summary', 'Issue Type', 'Status', 'Story Points', 'Created', 'Updated'];
    const second = await (await import('./helpers/fixtureWorkbook')).buildWorkbook(jiraHeaders, [
      ['J-1', 'Login', 'Bug', 'Done', 5, new Date('2026-01-01'), new Date('2026-01-05')],
    ]);

    const v2 = (await saveMapping(
      seeded.project.id,
      {
        externalId: 'Key',
        title: 'Summary',
        type: 'Issue Type',
        status: 'Status',
        storyPoints: 'Story Points',
        createdDate: 'Created',
        lastUpdated: 'Updated',
      },
      { buffer: second, originalname: 'second.xlsx' }
    )).body.data;

    expect(v2.version).toBe(2);
    expect(v2.sourceHeaders).toEqual(jiraHeaders);
    expect(v2.storagePath).not.toBe(v1.storagePath);

    // Both samples survive, so an old import can still be traced to the file that defined it.
    expect(fs.existsSync(v1.storagePath)).toBe(true);
    expect(fs.existsSync(v2.storagePath)).toBe(true);
  });

  it('returns the active mapping under field keys, ready for the editor', async () => {
    seeded = await seedProject({ mapping: null });
    const buffer = await buildAzureWorkbook(SAMPLE_ROWS);

    await saveMapping(seeded.project.id, AZURE_MAPPING, { buffer, originalname: 'azure-export.xlsx' });

    const details = await fetchMapping(seeded.project.id);

    expect(details.status).toBe(200);
    // Field keys, not human labels -- the editor looks them up by key.
    expect(details.body.data.externalId).toBe('ID');
    expect(details.body.data.storyPoints).toBe('Effort');
    expect(details.body.meta.version).toBe(1);
    expect(details.body.meta.sourceHeaders).toEqual([...AZURE_HEADERS]);
    expect(details.body.meta.file).toMatchObject({
      originalFilename: 'azure-export.xlsx',
      available: true,
    });
  });

  it('answers cleanly for a project that has no mapping', async () => {
    seeded = await seedProject({ mapping: null });

    const details = await fetchMapping(seeded.project.id);

    expect(details.status).toBe(200);
    expect(details.body.data).toBeNull();
    expect(details.body.message).toMatch(/no mapping/i);
  });

  it('never returns the retained file columns as if they were mappings', async () => {
    /*
     * template_mappings also holds the sample path, size and header list. If those leak into the
     * mapping object they are treated as columns the uploaded file must contain, and every upload
     * fails. Asserted at the boundary as well as in the parser.
     */
    seeded = await seedProject({ mapping: null });
    const buffer = await buildAzureWorkbook(SAMPLE_ROWS);
    await saveMapping(seeded.project.id, AZURE_MAPPING, { buffer, originalname: 'azure-export.xlsx' });

    const details = await fetchMapping(seeded.project.id);

    for (const leaked of ['storagePath', 'sourceHeaders', 'checksum', 'fileSize', 'version', 'mimeType']) {
      expect(details.body.data[leaked]).toBeUndefined();
    }
  });
});

describe('the effect of a mapping change on imported data', () => {
  it('leaves imported rows untouched and marks them as parsed by an older mapping', async () => {
    seeded = await seedProject({ mapping: AZURE_MAPPING });
    const project = seeded.project;

    await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'H-1', state: 'Done', effort: 5, iteration: 'Sprint A' },
        { id: 'H-2', state: 'New', effort: 3, iteration: 'Sprint A' },
      ])
    );

    const before = await excelSprintBoardService.getScorecard(project.id, 'Sprint A');
    expect(before.dataQuality.staleMappingTickets).toBe(0);

    await saveMapping(project.id, AZURE_MAPPING);
    await project.reload();

    const after = await excelSprintBoardService.getScorecard(project.id, 'Sprint A');

    // The numbers must not move: superseding a mapping does not re-parse anything.
    expect(after.totals.ticketCount).toBe(before.totals.ticketCount);
    expect(after.totals.finalScopeSp).toBe(before.totals.finalScopeSp);
    expect(after.totals.completedSp).toBe(before.totals.completedSp);
    expect(after.dataQuality.staleMappingTickets).toBe(2);
  });

  it('parses a later import with the new mapping', async () => {
    seeded = await seedProject({ mapping: AZURE_MAPPING });
    const project = seeded.project;

    await importFile(project, await buildAzureWorkbook([{ id: 'N-1', effort: 5, iteration: 'Sprint A' }]));

    // Stop mapping story points at all; the next import must carry none.
    const { storyPoints: _dropped, ...withoutPoints } = AZURE_MAPPING;
    await saveMapping(project.id, withoutPoints);
    await project.reload();

    await importFile(
      project,
      await buildAzureWorkbook([{ id: 'N-2', effort: 8, iteration: 'Sprint A' }]),
      { conflictStrategy: 'merge' }
    );

    const sc = await excelSprintBoardService.getScorecard(project.id, 'Sprint A');

    expect(sc.totals.ticketCount).toBe(2);
    // N-1 keeps the 5 it was imported with; N-2 has none because the new mapping ignores Effort.
    expect(sc.totals.finalScopeSp).toBe(5);
    expect(sc.dataQuality.rowsMissingSp).toBe(1);
  });
});
