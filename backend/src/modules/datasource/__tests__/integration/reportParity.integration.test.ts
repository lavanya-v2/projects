import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { PerfTicketFact } from '../../../../models/PerfTicketFact';
import { loadLatestImport } from '../../excelImportService';
import { getProjectIssueSource } from '../../../reports/services/issueSourceAdapter';
import { excelSprintBoardService } from '../../../reports/services/excelSprintBoardService';
import { AZURE_MAPPING, AzureRow, buildAzureWorkbook } from './helpers/fixtureWorkbook';
import { assertScratchDatabase, cleanupProject, importFile, SeededProject, seedProject } from './helpers/seed';

/**
 * Do the published reports agree with the file that was uploaded, and with each other?
 *
 * Excel data is read through two independent paths:
 *   Board View  -> excel_ticket_state          (every import, merged)
 *   DSR + rollups -> loadLatestImport()        (one import)
 *
 * The tests below pin both, so the extent of the disagreement is a measured number rather than a
 * claim, and so any future change to either path is visible here first.
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

const SPRINT_ONE = 'Sprint One';
const SPRINT_TWO = 'Sprint Two';

// 3 tickets, 12 SP, 2 done / 9 SP done.
const FILE_ONE: AzureRow[] = [
  { id: 'A-1', type: 'Bug', state: 'Done', effort: 5, assignee: 'a@x.com', iteration: SPRINT_ONE },
  { id: 'A-2', type: 'Product Backlog Item', state: 'Done', effort: 4, assignee: 'b@x.com', iteration: SPRINT_ONE },
  { id: 'A-3', type: 'Product Backlog Item', state: 'Active', effort: 3, assignee: 'b@x.com', iteration: SPRINT_ONE },
];

// 2 tickets, 9 SP, 1 done / 6 SP done.
const FILE_TWO: AzureRow[] = [
  { id: 'B-1', type: 'Bug', state: 'Done', effort: 6, assignee: 'a@x.com', iteration: SPRINT_TWO },
  { id: 'B-2', type: 'Product Backlog Item', state: 'New', effort: 3, assignee: 'c@x.com', iteration: SPRINT_TWO },
];

describe('board view against the source file', () => {
  it('reproduces the file exactly, field by field', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(FILE_ONE));

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT_ONE);

    expect(sc.totals.ticketCount).toBe(3);
    expect(sc.totals.finalScopeSp).toBe(12);
    expect(sc.totals.completedSp).toBe(9);
    expect(sc.totals.completedCount).toBe(2);
    expect(sc.totals.spilloverCount).toBe(1);
    expect(sc.totals.spilloverSp).toBe(3);
    expect(sc.totals.bugCount).toBe(1);
    expect(sc.totals.unassignedCount).toBe(0);
    expect(sc.totals.deliveryPct).toBe(75);
    expect(sc.totals.ticketDeliveryPct).toBe(66.7);

    // Per developer: a@x.com 5/5 done, b@x.com 4 of 7 done.
    const byDev = new Map(sc.developers.map(d => [d.assignee, d]));
    expect(byDev.get('a@x.com')).toMatchObject({ spPlanned: 5, spDone: 5, ticketCount: 1, deliveryPct: 100 });
    expect(byDev.get('b@x.com')).toMatchObject({ spPlanned: 7, spDone: 4, ticketCount: 2, deliveryPct: 57.1 });
  });

  it('accumulates across imports, so the board reflects everything uploaded', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(FILE_ONE));
    await importFile(project, await buildAzureWorkbook(FILE_TWO));

    const one = await excelSprintBoardService.getScorecard(project.id, SPRINT_ONE);
    const two = await excelSprintBoardService.getScorecard(project.id, SPRINT_TWO);

    expect(one.totals.ticketCount).toBe(3);
    expect(one.totals.finalScopeSp).toBe(12);
    expect(two.totals.ticketCount).toBe(2);
    expect(two.totals.finalScopeSp).toBe(9);

    const sprints = await excelSprintBoardService.listSprints(project.id);
    expect(sprints.map(s => s.sprintName).sort()).toEqual([SPRINT_ONE, SPRINT_TWO]);
    expect(sprints.reduce((sum, s) => sum + s.ticketCount, 0)).toBe(5);
  });
});

describe('the DSR read path', () => {
  it('agrees with the board when the project has exactly one import', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(FILE_ONE));

    const source = getProjectIssueSource(project);
    const { issues } = await source.getIssuesForBoard(project.id);

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT_ONE);

    expect(issues.map(i => i.key).sort()).toEqual(['A-1', 'A-2', 'A-3']);
    expect(issues).toHaveLength(sc.totals.ticketCount);
  });

  it('carries each row through to the Jira-shaped envelope faithfully', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(FILE_ONE));

    const source = getProjectIssueSource(project);
    const { issues } = await source.getIssuesForBoard(project.id);
    const a1 = issues.find(i => i.key === 'A-1')!;

    expect(a1.fields.status.name).toBe('Done');
    expect(a1.fields.issuetype?.name).toBe('Bug');
    expect(a1.fields.assignee?.emailAddress).toBe('a@x.com');
  });

  it('SEES ONLY THE MOST RECENT IMPORT — the board and the DSR disagree', async () => {
    /*
     * FINDING (SEV1). The board merges every import; this path loads one. With two uploads covering
     * different sprints, the board reports 5 tickets across both sprints while the DSR -- and every
     * weekly, monthly and account rollup built on it -- sees only the 2 tickets in the newer file.
     *
     * Asserted as-is so the divergence is measured, not assumed. When it is fixed, this test fails
     * and is the record of what changed.
     */
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(FILE_ONE));
    await importFile(project, await buildAzureWorkbook(FILE_TWO));

    const source = getProjectIssueSource(project);
    const { issues } = await source.getIssuesForBoard(project.id);

    const boardTickets = (await excelSprintBoardService.listSprints(project.id)).reduce(
      (sum, s) => sum + s.ticketCount,
      0
    );

    expect(boardTickets).toBe(5);
    expect(issues.map(i => i.key).sort()).toEqual(['B-1', 'B-2']);
    expect(issues).toHaveLength(2);

    // A-1..A-3 exist in the projection and are invisible to every DSR-derived report.
    expect(issues.some(i => i.key.startsWith('A-'))).toBe(false);
  });

  it('loses a re-uploaded sprint when a later upload covers a different sprint', async () => {
    /*
     * The same defect in its most damaging form: nothing was deleted and the board is correct, but
     * the newest file decides the entire DSR. Uploading sprint 2 makes sprint 1 vanish from the
     * narrative even though its data is intact.
     */
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(FILE_ONE));

    const before = await loadLatestImport(project.id);
    expect(before!.rows.map(r => r.extId).sort()).toEqual(['A-1', 'A-2', 'A-3']);

    await importFile(project, await buildAzureWorkbook(FILE_TWO));

    const after = await loadLatestImport(project.id);
    expect(after!.rows.map(r => r.extId).sort()).toEqual(['B-1', 'B-2']);
  });

  it('reports nothing at all for a project whose only import was deleted', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(FILE_ONE));

    const source = getProjectIssueSource(project);
    expect((await source.getIssuesForBoard(project.id)).issues).toHaveLength(3);
  });
});

describe('sprint registry', () => {
  it('records every sprint the imports mention, for the DSR active-sprint lookup', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(FILE_ONE));
    await importFile(project, await buildAzureWorkbook(FILE_TWO));

    const source = getProjectIssueSource(project);
    const active = await source.getActiveSprint(project.id);

    // Both sprints are registered even though only one import is readable through this path.
    expect(active).not.toBeNull();
    expect([SPRINT_ONE, SPRINT_TWO]).toContain(active!.name);
  });
});

describe('trends and executive dashboard', () => {
  it('never receives Excel data — those views read the Jira sync tables', async () => {
    /*
     * FINDING (SEV2). Trends and the Executive dashboard are built from PerfTicketFact, which only
     * the Jira/Azure performance sync writes. No Excel path populates it, so an Excel project is
     * absent from those views entirely rather than showing as zero.
     */
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(FILE_ONE));
    await importFile(project, await buildAzureWorkbook(FILE_TWO));

    expect(await PerfTicketFact.count({ where: { projectId: project.id } })).toBe(0);
  });
});
