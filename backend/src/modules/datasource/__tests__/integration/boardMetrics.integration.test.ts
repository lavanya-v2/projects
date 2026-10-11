import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { excelSprintBoardService } from '../../../reports/services/excelSprintBoardService';
import { AZURE_MAPPING, AzureRow, buildAzureWorkbook } from './helpers/fixtureWorkbook';
import {
  assertScratchDatabase,
  cleanupProject,
  importFile,
  saveMappingVersion,
  SeededProject,
  seedProject,
} from './helpers/seed';

/**
 * Board View metrics: what is counted, what is deliberately excluded, and whether the parts add up.
 *
 * Expected values are written from the fixture rows directly above each test.
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

const SPRINT = 'Sprint A';

describe('container exclusion', () => {
  /*
   * E-1 is an Epic with two children, so it is a container: no effort of its own, never assigned.
   * B-9 is a Bug that ALSO has a child and carries 3 points -- the case a naive "anything that is a
   * parent" rule would wrongly drop.
   *
   * Counted: C-1 (5), C-2 (3), B-9 (3), B-10 (2) = 4 tickets, 13 SP.
   */
  const ROWS: AzureRow[] = [
    { id: 'E-1', type: 'Feature', state: 'Active', effort: null, assignee: '', iteration: SPRINT },
    { id: 'C-1', type: 'Product Backlog Item', state: 'Done', effort: 5, assignee: 'a@x.com', parent: 'E-1', iteration: SPRINT },
    { id: 'C-2', type: 'Product Backlog Item', state: 'New', effort: 3, assignee: 'a@x.com', parent: 'E-1', iteration: SPRINT },
    { id: 'B-9', type: 'Bug', state: 'Done', effort: 3, assignee: 'b@x.com', iteration: SPRINT },
    { id: 'B-10', type: 'Bug', state: 'New', effort: 2, assignee: 'b@x.com', parent: 'B-9', iteration: SPRINT },
  ];

  it('excludes the Epic but keeps a Bug that happens to be a parent', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(ROWS));

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);

    expect(sc.totals.ticketCount).toBe(4);
    expect(sc.dataQuality.containersExcluded).toBe(1);
    expect(sc.totals.finalScopeSp).toBe(13);
    expect(sc.totals.completedSp).toBe(8); // C-1 (5) + B-9 (3)
    expect(sc.totals.bugCount).toBe(2); // B-9 and B-10 both survive
    expect(sc.totals.typeBreakdown.map(t => t.type).sort()).toEqual(['Backlog', 'Bug']);
  });

  it('leaves the unassigned count free of containers', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(ROWS));

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);

    // Every counted ticket has an assignee; only the Epic did not, and it is excluded.
    expect(sc.totals.unassignedCount).toBe(0);
  });

  it('keeps the sprint list in step with the scorecard', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(ROWS));

    const [summary] = await excelSprintBoardService.listSprints(project.id);
    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);

    expect(summary.ticketCount).toBe(sc.totals.ticketCount);
    expect(summary.ticketCount).toBe(4);
  });

  it('excludes a container whose children live in a different sprint', async () => {
    /*
     * The parent set has to be built project-wide. Scoped per sprint, an Epic uploaded separately
     * from its children would look childless and be counted as a work item.
     */
    const project = await newProject();
    await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'E-2', type: 'Feature', state: 'Active', effort: null, iteration: 'Sprint P' },
        { id: 'K-1', type: 'Product Backlog Item', state: 'Done', effort: 5, parent: 'E-2', iteration: 'Sprint Q' },
      ])
    );

    const p = await excelSprintBoardService.getScorecard(project.id, 'Sprint P');
    const q = await excelSprintBoardService.getScorecard(project.id, 'Sprint Q');

    expect(p.totals.ticketCount).toBe(0);
    expect(p.dataQuality.containersExcluded).toBe(1);
    expect(q.totals.ticketCount).toBe(1);
  });

  it('counts a childless Epic as a real ticket', async () => {
    // Being an Epic is not enough. Only an Epic something hangs off is a container.
    const project = await newProject();
    await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'E-3', type: 'Feature', state: 'Done', effort: 8, assignee: 'a@x.com', iteration: SPRINT },
      ])
    );

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);

    expect(sc.totals.ticketCount).toBe(1);
    expect(sc.dataQuality.containersExcluded).toBe(0);
    expect(sc.totals.finalScopeSp).toBe(8);
  });

  it('reports an all-container sprint as empty rather than failing', async () => {
    const project = await newProject();
    await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'E-4', type: 'Feature', state: 'Active', effort: null, iteration: 'Container Only' },
        { id: 'C-9', type: 'Product Backlog Item', state: 'New', effort: 5, parent: 'E-4', iteration: 'Elsewhere' },
      ])
    );

    const sc = await excelSprintBoardService.getScorecard(project.id, 'Container Only');

    expect(sc.totals.ticketCount).toBe(0);
    expect(sc.totals.deliveryPct).toBe(0);
    expect(sc.totals.ticketDeliveryPct).toBe(0);
    expect(sc.developers).toEqual([]);
  });
});

describe('completion', () => {
  it('treats the default done statuses as complete', async () => {
    const project = await newProject();
    await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'D-1', state: 'Done', effort: 1, iteration: SPRINT },
        { id: 'D-2', state: 'Closed', effort: 1, iteration: SPRINT },
        { id: 'D-3', state: 'Resolved', effort: 1, iteration: SPRINT },
        { id: 'D-4', state: 'Completed', effort: 1, iteration: SPRINT },
        { id: 'D-5', state: 'Released', effort: 1, iteration: SPRINT },
        { id: 'D-6', state: 'Active', effort: 1, iteration: SPRINT },
      ])
    );

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);

    expect(sc.totals.completedCount).toBe(5);
    expect(sc.totals.spilloverCount).toBe(1);
  });

  it('honours a project-specific done list instead of the default', async () => {
    const project = await newProject({ kanbanDoneStatuses: ['Shipped', 'Verified'] });
    await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'S-1', state: 'Shipped', effort: 2, iteration: SPRINT },
        { id: 'S-2', state: 'Verified', effort: 3, iteration: SPRINT },
        // 'Done' is NOT in this project's list, so it must not count as complete.
        { id: 'S-3', state: 'Done', effort: 5, iteration: SPRINT },
      ])
    );

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);

    expect(sc.totals.completedCount).toBe(2);
    expect(sc.totals.completedSp).toBe(5);
    expect(sc.totals.spilloverSp).toBe(5);
  });

  it('matches statuses regardless of case and padding', async () => {
    const project = await newProject();
    await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'X-1', state: '  done  ', effort: 2, iteration: SPRINT },
        { id: 'X-2', state: 'DONE', effort: 3, iteration: SPRINT },
      ])
    );

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);
    expect(sc.totals.completedCount).toBe(2);
  });
});

describe('story points', () => {
  it('counts a blank estimate as 0 but reports it as missing', async () => {
    // A blank estimate is not the same as a zero one; conflating them hides an incomplete file.
    const project = await newProject();
    await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'P-1', state: 'Done', effort: 5, iteration: SPRINT },
        { id: 'P-2', state: 'Done', effort: null, iteration: SPRINT },
        { id: 'P-3', state: 'New', effort: 0, iteration: SPRINT },
      ])
    );

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);

    expect(sc.totals.finalScopeSp).toBe(5);
    expect(sc.totals.ticketCount).toBe(3);
    expect(sc.dataQuality.rowsMissingSp).toBe(1); // only P-2; P-3 is a real zero
  });

  it('preserves fractional estimates', async () => {
    const project = await newProject();
    await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'F-1', state: 'Done', effort: 0.5, iteration: SPRINT },
        { id: 'F-2', state: 'Done', effort: 1.25, iteration: SPRINT },
      ])
    );

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);
    expect(sc.totals.finalScopeSp).toBe(1.8); // 1.75 rounded to one decimal for display
    expect(sc.totals.deliveryPct).toBe(100);
  });

  it('reports no delivery percentage for a sprint with no estimates at all', async () => {
    const project = await newProject();
    await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'N-1', state: 'Done', effort: null, iteration: SPRINT },
        { id: 'N-2', state: 'New', effort: null, iteration: SPRINT },
      ])
    );

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);

    expect(sc.totals.hasStoryPoints).toBe(false);
    expect(sc.totals.deliveryPct).toBe(0);
    // Ticket delivery is the usable signal when nothing is estimated.
    expect(sc.totals.ticketDeliveryPct).toBe(50);
  });

  it('carries hours through the same field for hours-based projects', async () => {
    const project = await newProject({ estimationType: 'hours' });
    await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'H-1', state: 'Done', effort: 16, iteration: SPRINT },
        { id: 'H-2', state: 'New', effort: 24, iteration: SPRINT },
      ])
    );

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);
    expect(sc.totals.finalScopeSp).toBe(40);
    expect(sc.totals.completedSp).toBe(16);
  });
});

describe('staleness', () => {
  it('counts tickets whose import predates the active mapping', async () => {
    const project = await newProject();
    await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'ST-1', state: 'Done', effort: 5, iteration: SPRINT },
        { id: 'ST-2', state: 'New', effort: 3, iteration: SPRINT },
      ])
    );

    const before = await excelSprintBoardService.getScorecard(project.id, SPRINT);
    expect(before.dataQuality.staleMappingTickets).toBe(0);

    await saveMappingVersion(project, AZURE_MAPPING);
    await project.reload();

    const after = await excelSprintBoardService.getScorecard(project.id, SPRINT);
    // Data is kept exactly as imported; only the label changes.
    expect(after.dataQuality.staleMappingTickets).toBe(2);
    expect(after.totals.ticketCount).toBe(2);
    expect(after.totals.finalScopeSp).toBe(8);
  });

  it('clears once the file is re-imported under the current mapping', async () => {
    const project = await newProject();
    const file = await buildAzureWorkbook([{ id: 'ST-3', state: 'Done', effort: 5, iteration: SPRINT }]);

    await importFile(project, file);
    await saveMappingVersion(project, AZURE_MAPPING);
    await project.reload();

    expect((await excelSprintBoardService.getScorecard(project.id, SPRINT)).dataQuality.staleMappingTickets).toBe(1);

    await importFile(project, file, { conflictStrategy: 'merge' });

    expect((await excelSprintBoardService.getScorecard(project.id, SPRINT)).dataQuality.staleMappingTickets).toBe(0);
  });
});

describe('sprint window', () => {
  it('flags a sprint whose rows disagree about its dates', async () => {
    const project = await newProject({
      mapping: { ...AZURE_MAPPING, sprintStartDate: 'Created Date', sprintEndDate: 'Changed Date' },
    });

    await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'W-1', effort: 1, iteration: SPRINT, created: '2026-02-01', changed: '2026-02-14' },
        { id: 'W-2', effort: 1, iteration: SPRINT, created: '2026-02-03', changed: '2026-02-14' },
      ])
    );

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);

    expect(sc.dataQuality.sprintWindowVaries).toBe(true);
    // The window spans the widest range the rows report.
    expect(sc.start).toBe('2026-02-01');
    expect(sc.end).toBe('2026-02-14');
  });
});
