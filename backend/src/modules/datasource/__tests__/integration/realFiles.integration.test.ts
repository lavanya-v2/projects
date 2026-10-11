import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractHeaders } from '../../excelTemplateValidator';
import { excelSprintBoardService } from '../../../reports/services/excelSprintBoardService';
import { loadLatestImport } from '../../excelImportService';
import { assertScratchDatabase, cleanupProject, importFile, SeededProject, seedProject } from './helpers/seed';

/**
 * Real customer exports, as an anchor against the synthetic fixtures.
 *
 * The fixtures prove the rules; these prove the rules survive contact with files nobody designed for
 * us -- 2,600-column Jira dumps, repeated header names, two Azure vocabularies for the same customer.
 *
 * The files are not in the repo (they are customer data), so the whole block skips when the folder is
 * absent. Point EXCEL_FIXTURE_DIR elsewhere to run them from another location.
 */

const FIXTURE_DIR = process.env.EXCEL_FIXTURE_DIR || path.join(os.homedir(), 'Desktop', 'XLS');
const available = fs.existsSync(FIXTURE_DIR);

const read = (name: string): Buffer => fs.readFileSync(path.join(FIXTURE_DIR, name));

/** Azure DevOps export using 'Effort' for the estimate. */
const AZURE_EFFORT = {
  externalId: 'ID',
  title: 'Title',
  type: 'Work Item Type',
  status: 'State',
  priority: 'Priority',
  storyPoints: 'Effort',
  assigneeEmail: 'Assigned To',
  sprintName: 'Iteration Path',
  createdDate: 'Created Date',
  lastUpdated: 'Changed Date',
  parentExtId: 'Parent',
  labels: 'Tags',
};

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

describe.skipIf(!available)('real customer exports', () => {
  it('reproduces the MTN SDK reconciliation exactly', async () => {
    /*
     * The regression anchor. These numbers were reconciled against the file by hand and are the
     * reference every later change is measured against.
     */
    seeded = await seedProject({ mapping: AZURE_EFFORT });
    const { validation } = await importFile(seeded.project, read('Sprint Report_MTN_SDK_Arpith.xlsx'));

    expect(validation.ok).toBe(true);
    expect(validation.rows).toHaveLength(78);

    const sprints = await excelSprintBoardService.listSprints(seeded.project.id);
    const counted = sprints.reduce((sum, s) => sum + s.ticketCount, 0);

    expect(counted).toBe(61); // 78 rows less 17 Epic/Feature containers
    expect(sprints).toHaveLength(7);

    const totals = { tickets: 0, done: 0, sp: 0, doneSp: 0, unassigned: 0, containers: 0 };
    for (const s of sprints) {
      const sc = await excelSprintBoardService.getScorecard(seeded.project.id, s.sprintName);
      totals.tickets += sc.totals.ticketCount;
      totals.done += sc.totals.completedCount;
      totals.sp += sc.totals.finalScopeSp;
      totals.doneSp += sc.totals.completedSp;
      totals.unassigned += sc.totals.unassignedCount;
      totals.containers += sc.dataQuality.containersExcluded;
    }

    expect(totals.tickets).toBe(61);
    expect(totals.containers).toBe(17);
    expect(totals.sp).toBe(160);
    expect(totals.doneSp).toBe(82);
    expect(totals.unassigned).toBe(9);
    expect(Number(((totals.done / totals.tickets) * 100).toFixed(1))).toBe(41.0);
  });

  it('merges two real sprint exports without losing or duplicating a ticket', async () => {
    /*
     * The scenario the customer actually ran: consecutive sprint exports uploaded one after the
     * other. Sprint 33 and Sprint 34 overlap in the file (each export carries a tail of the other),
     * so this is a genuine merge, not two disjoint loads.
     */
    seeded = await seedProject({ mapping: AZURE_EFFORT });
    const project = seeded.project;

    const first = await importFile(project, read('MTN_MOMOSDK_Sprint33_20260714.csv'), { fileType: 'csv' });
    const second = await importFile(project, read('MTN_MOMOSDK_Sprint34_20260728.csv'), {
      fileType: 'csv',
      conflictStrategy: 'merge',
    });

    expect(first.validation.ok).toBe(true);
    expect(second.validation.ok).toBe(true);

    const idsIn = (v: typeof first.validation) => new Set(v.rows.map(r => `${r.sprintName}::${r.extId}`));
    const union = new Set([...idsIn(first.validation), ...idsIn(second.validation)]);

    const sprints = await excelSprintBoardService.listSprints(project.id);
    const stored = sprints.reduce((sum, s) => sum + s.ticketCount, 0);

    let containers = 0;
    for (const s of sprints) {
      containers += (await excelSprintBoardService.getScorecard(project.id, s.sprintName)).dataQuality
        .containersExcluded;
    }

    // Every (sprint, ticket) pair across both files is stored exactly once.
    expect(stored + containers).toBe(union.size);
  });

  it('keeps the sprints of the older export visible after the newer one lands', async () => {
    seeded = await seedProject({ mapping: AZURE_EFFORT });
    const project = seeded.project;

    await importFile(project, read('MTN_MOMOSDK_Sprint33_20260714.csv'), { fileType: 'csv' });
    const afterFirst = await excelSprintBoardService.listSprints(project.id);

    await importFile(project, read('MTN_MOMOSDK_Sprint34_20260728.csv'), {
      fileType: 'csv',
      conflictStrategy: 'merge',
    });
    const afterSecond = await excelSprintBoardService.listSprints(project.id);

    for (const s of afterFirst) {
      expect(afterSecond.map(x => x.sprintName)).toContain(s.sprintName);
    }

    // ...but the DSR path still sees only the newer file. Pinned so the gap stays measured.
    const latest = await loadLatestImport(project.id);
    const boardTickets = afterSecond.reduce((sum, s) => sum + s.ticketCount, 0);
    expect(latest!.rows.length).toBeLessThan(boardTickets);
  });

  it('rejects the sibling export that uses a different estimate column', async () => {
    /*
     * Same customer, same tool, different column names: MTN One uses 'Story Points' and
     * 'State Change Date' where MTN SDK uses 'Effort' and 'Changed Date'. A project mapped for one
     * must not silently import the other with blank estimates.
     */
    seeded = await seedProject({ mapping: AZURE_EFFORT });
    const { validation, imp } = await importFile(seeded.project, read('Sprint Report_MTN One_Tanmay.xlsx'));

    expect(validation.ok).toBe(false);
    expect(validation.errors.some(e => e.reason === 'Missing required column: Effort')).toBe(true);
    expect(imp).toBeNull();
  });

  it('imports a Jira-vocabulary export with repeated header names', async () => {
    // 'Labels' appears ten times in this export; the repeats must not corrupt the parse.
    const headers = await extractHeaders(read('Entelect_BUPA_Sprint 2610 (1).xlsx'), 'excel');
    expect(headers.filter(h => h === 'Labels')).toHaveLength(10);

    seeded = await seedProject({
      mapping: {
        externalId: 'Issue key',
        title: 'Summary',
        type: 'Issue Type',
        status: 'Status',
        priority: 'Priority',
        assigneeEmail: 'Assignee Email',
        sprintName: 'Sprint Name',
        storyPoints: 'Custom field (Story Points)',
        createdDate: 'Created',
        lastUpdated: 'Updated',
        parentExtId: 'Parent key',
        labels: 'Labels',
      },
    });

    const { validation } = await importFile(seeded.project, read('Entelect_BUPA_Sprint 2610 (1).xlsx'));

    expect(validation.ok).toBe(true);
    expect(validation.mode).toBe('strict');
    expect(validation.rows).toHaveLength(4);
    expect(validation.sprintCoverage.sprintsInFile).toEqual([{ sprintName: '2610 Wellbeing', rows: 4 }]);
  });

  it('reads a 2,600-column Jira export without failing', async () => {
    // Width alone must not break header resolution, even though most columns are irrelevant.
    const headers = await extractHeaders(read('Entelect_SB_JIRA_7_EXCEL (2).xlsx'), 'excel');

    expect(headers.length).toBeGreaterThan(2600);
    expect(headers).toContain('Issue key');
    expect(headers).toContain('Sprint');

    seeded = await seedProject({
      mapping: {
        externalId: 'Issue key',
        title: 'Summary',
        type: 'Issue Type',
        status: 'Status',
        createdDate: 'Created',
        lastUpdated: 'Updated',
        sprintName: 'Sprint',
      },
    });

    const { validation } = await importFile(seeded.project, read('Entelect_SB_JIRA_7_EXCEL (2).xlsx'));

    // Whatever the verdict, it must be a considered one rather than a crash.
    expect(Array.isArray(validation.rows)).toBe(true);
    expect(validation.mappingReport.find(m => m.field === 'externalId')?.matched).toBe(true);
  });
});
