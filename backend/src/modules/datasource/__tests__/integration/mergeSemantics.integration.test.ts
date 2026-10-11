import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { ExcelTicketState } from '../../../../models/ExcelTicketState';
import { deleteImport } from '../../excelImportService';
import { previewImpact, renameOrMergeSprints, sprintKey } from '../../excelProjectionService';
import { excelSprintBoardService } from '../../../reports/services/excelSprintBoardService';
import { AZURE_MAPPING, AzureRow, buildAzureWorkbook } from './helpers/fixtureWorkbook';
import { assertScratchDatabase, cleanupProject, importFile, SeededProject, seedProject } from './helpers/seed';

/**
 * Merge, replace and replay semantics -- the core of "does the report match the file".
 *
 * Every expected number below is written by hand from the fixture rows immediately above it. None is
 * produced by running the importer.
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

async function newProject() {
  seeded = await seedProject({ mapping: AZURE_MAPPING });
  return seeded.project;
}

/** Current projection for a sprint, as (extId -> story points). */
async function projectionOf(projectId: number, sprintName: string) {
  const rows = await ExcelTicketState.findAll({
    where: { projectId, sprintKey: sprintKey(sprintName) },
    order: [['extId', 'ASC']],
  });

  return {
    extIds: rows.map(r => r.extId),
    tickets: rows.length,
    storyPoints: rows.reduce((sum, r) => sum + (r.storyPoints ?? 0), 0),
    byId: new Map(rows.map(r => [r.extId, r])),
  };
}

// 4 tickets, 2 done, 20 SP total, 12 SP done. Every assertion below refers back to these literals.
const SPRINT = 'Sprint A';
const BASE_ROWS: AzureRow[] = [
  { id: 'T-1', type: 'Bug', state: 'Done', effort: 5, assignee: 'a@x.com', iteration: SPRINT },
  { id: 'T-2', type: 'Bug', state: 'Active', effort: 3, assignee: 'a@x.com', iteration: SPRINT },
  { id: 'T-3', type: 'Product Backlog Item', state: 'Done', effort: 7, assignee: 'b@x.com', iteration: SPRINT },
  { id: 'T-4', type: 'Product Backlog Item', state: 'New', effort: 5, assignee: '', iteration: SPRINT },
];

describe('first import', () => {
  it('projects exactly the rows in the file', async () => {
    const project = await newProject();
    const { validation, imp } = await importFile(project, await buildAzureWorkbook(BASE_ROWS));

    expect(validation.errors).toEqual([]);
    expect(imp).not.toBeNull();
    expect(imp!.rowCount).toBe(4);

    const state = await projectionOf(project.id, SPRINT);
    expect(state.extIds).toEqual(['T-1', 'T-2', 'T-3', 'T-4']);
    expect(state.tickets).toBe(4);
    expect(state.storyPoints).toBe(20);
  });

  it('reports board totals equal to the file', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(BASE_ROWS));

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);

    expect(sc.totals.ticketCount).toBe(4);
    expect(sc.totals.finalScopeSp).toBe(20);
    expect(sc.totals.completedSp).toBe(12); // T-1 (5) + T-3 (7)
    expect(sc.totals.completedCount).toBe(2);
    expect(sc.totals.deliveryPct).toBe(60); // 12/20
    expect(sc.totals.ticketDeliveryPct).toBe(50); // 2/4
    expect(sc.totals.bugCount).toBe(2);
    expect(sc.totals.unassignedCount).toBe(1); // T-4
    expect(sc.totals.spilloverCount).toBe(2);
    expect(sc.totals.spilloverSp).toBe(8); // T-2 (3) + T-4 (5)
  });

  it('per-developer rows sum to the headline totals', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(BASE_ROWS));

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);
    const sum = (pick: (d: (typeof sc.developers)[number]) => number) =>
      sc.developers.reduce((total, dev) => total + pick(dev), 0);

    expect(sum(d => d.ticketCount)).toBe(sc.totals.ticketCount);
    expect(sum(d => d.spPlanned)).toBe(sc.totals.finalScopeSp);
    expect(sum(d => d.spDone)).toBe(sc.totals.completedSp);
    expect(sum(d => d.completedCount)).toBe(sc.totals.completedCount);
    expect(sum(d => d.bugCount)).toBe(sc.totals.bugCount);
  });
});

describe('re-uploading the same sprint', () => {
  it('does not double-count an identical re-upload', async () => {
    const project = await newProject();
    const file = await buildAzureWorkbook(BASE_ROWS);

    await importFile(project, file);
    await importFile(project, file, { conflictStrategy: 'merge' });

    // Identity is (project, sprint, ticket), so the same ticket overwrites its own row.
    const state = await projectionOf(project.id, SPRINT);
    expect(state.tickets).toBe(4);
    expect(state.storyPoints).toBe(20);
  });

  it('updates a ticket in place when its values change', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(BASE_ROWS));

    // T-2 moves to Done and is re-estimated 3 -> 8. Total SP 20 -> 25, done SP 12 -> 20.
    const updated = BASE_ROWS.map(r => (r.id === 'T-2' ? { ...r, state: 'Done', effort: 8 } : r));
    await importFile(project, await buildAzureWorkbook(updated), { conflictStrategy: 'merge' });

    const state = await projectionOf(project.id, SPRINT);
    expect(state.tickets).toBe(4);
    expect(state.storyPoints).toBe(25);
    expect(state.byId.get('T-2')!.status).toBe('Done');

    const sc = await excelSprintBoardService.getScorecard(project.id, SPRINT);
    expect(sc.totals.finalScopeSp).toBe(25);
    expect(sc.totals.completedSp).toBe(20);
    expect(sc.totals.completedCount).toBe(3);
  });

  it('merge keeps a ticket missing from the newer file; replace removes it', async () => {
    const withoutT4 = BASE_ROWS.filter(r => r.id !== 'T-4'); // 3 tickets, 15 SP

    const mergeProject = await newProject();
    await importFile(mergeProject, await buildAzureWorkbook(BASE_ROWS));
    await importFile(mergeProject, await buildAzureWorkbook(withoutT4), { conflictStrategy: 'merge' });

    const merged = await projectionOf(mergeProject.id, SPRINT);
    expect(merged.extIds).toEqual(['T-1', 'T-2', 'T-3', 'T-4']);
    expect(merged.storyPoints).toBe(20);

    await cleanupProject(seeded!);
    seeded = null;

    const replaceProject = await newProject();
    await importFile(replaceProject, await buildAzureWorkbook(BASE_ROWS));
    await importFile(replaceProject, await buildAzureWorkbook(withoutT4), { conflictStrategy: 'replace' });

    const replaced = await projectionOf(replaceProject.id, SPRINT);
    expect(replaced.extIds).toEqual(['T-1', 'T-2', 'T-3']);
    expect(replaced.storyPoints).toBe(15);
  });

  it('unions disjoint tickets uploaded into the same sprint', async () => {
    const project = await newProject();

    await importFile(project, await buildAzureWorkbook(BASE_ROWS.slice(0, 2))); // T-1, T-2 = 8 SP
    await importFile(project, await buildAzureWorkbook(BASE_ROWS.slice(2)), { conflictStrategy: 'merge' }); // T-3, T-4 = 12 SP

    const state = await projectionOf(project.id, SPRINT);
    expect(state.extIds).toEqual(['T-1', 'T-2', 'T-3', 'T-4']);
    expect(state.storyPoints).toBe(20);
  });
});

describe('previewImpact', () => {
  it('reports the collision and what each strategy would leave behind', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(BASE_ROWS));

    // Incoming: T-1 unchanged, T-2 re-estimated, T-5 new. T-3 and T-4 absent.
    const incoming = [
      { extId: 'T-1', sprintName: SPRINT, storyPoints: 5 },
      { extId: 'T-2', sprintName: SPRINT, storyPoints: 8 },
      { extId: 'T-5', sprintName: SPRINT, storyPoints: 2 },
    ];

    const impact = await previewImpact(project.id, incoming);

    expect(impact.hasCollision).toBe(true);
    expect(impact.sprints).toHaveLength(1);

    const [s] = impact.sprints;
    expect(s.existingTickets).toBe(4);
    expect(s.existingStoryPoints).toBe(20);
    expect(s.incomingRows).toBe(3);
    expect(s.updates).toBe(2); // T-1, T-2
    expect(s.additions).toBe(1); // T-5
    expect(s.missing).toBe(2); // T-3, T-4
    // Merge keeps T-3 (7) and T-4 (5): 5 + 8 + 2 + 12 = 27 across 5 tickets.
    expect(s.totalsAfter.merge).toEqual({ tickets: 5, storyPoints: 27 });
    expect(s.totalsAfter.replace).toEqual({ tickets: 3, storyPoints: 15 });
  });

  it('reports no collision for a sprint with nothing stored', async () => {
    const project = await newProject();

    const impact = await previewImpact(project.id, [
      { extId: 'T-1', sprintName: 'Untouched Sprint', storyPoints: 5 },
    ]);

    expect(impact.hasCollision).toBe(false);
  });
});

describe('multi-sprint files', () => {
  // 5 tickets across 3 sprints: X = 2 tickets / 8 SP, Y = 2 / 9, Z = 1 / 4. Total 5 / 21.
  const MULTI: AzureRow[] = [
    { id: 'M-1', state: 'Done', effort: 5, iteration: 'Sprint X' },
    { id: 'M-2', state: 'New', effort: 3, iteration: 'Sprint X' },
    { id: 'M-3', state: 'Done', effort: 4, iteration: 'Sprint Y' },
    { id: 'M-4', state: 'New', effort: 5, iteration: 'Sprint Y' },
    { id: 'M-5', state: 'Done', effort: 4, iteration: 'Sprint Z' },
  ];

  it('splits into separate sprints whose totals sum to the file', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(MULTI));

    const sprints = await excelSprintBoardService.listSprints(project.id);
    expect(sprints.map(s => s.sprintName).sort()).toEqual(['Sprint X', 'Sprint Y', 'Sprint Z']);

    const x = await excelSprintBoardService.getScorecard(project.id, 'Sprint X');
    const y = await excelSprintBoardService.getScorecard(project.id, 'Sprint Y');
    const z = await excelSprintBoardService.getScorecard(project.id, 'Sprint Z');

    expect([x.totals.ticketCount, y.totals.ticketCount, z.totals.ticketCount]).toEqual([2, 2, 1]);
    expect([x.totals.finalScopeSp, y.totals.finalScopeSp, z.totals.finalScopeSp]).toEqual([8, 9, 4]);

    // The whole point: nothing is lost or duplicated by the split.
    const totalTickets = x.totals.ticketCount + y.totals.ticketCount + z.totals.ticketCount;
    const totalSp = x.totals.finalScopeSp + y.totals.finalScopeSp + z.totals.finalScopeSp;
    expect(totalTickets).toBe(5);
    expect(totalSp).toBe(21);
  });

  it('keeps sprints independent when uploaded in separate files', async () => {
    const project = await newProject();

    await importFile(project, await buildAzureWorkbook(MULTI.filter(r => r.iteration === 'Sprint X')));
    await importFile(project, await buildAzureWorkbook(MULTI.filter(r => r.iteration === 'Sprint Y')));

    const x = await projectionOf(project.id, 'Sprint X');
    const y = await projectionOf(project.id, 'Sprint Y');

    expect(x.tickets).toBe(2);
    expect(x.storyPoints).toBe(8);
    expect(y.tickets).toBe(2);
    expect(y.storyPoints).toBe(9);
  });

  it('scopes a replace to the sprints the file actually contains', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(MULTI));

    // Replace covering only Sprint X must not touch Y or Z.
    await importFile(
      project,
      await buildAzureWorkbook([{ id: 'M-9', state: 'Done', effort: 1, iteration: 'Sprint X' }]),
      { conflictStrategy: 'replace' }
    );

    const x = await projectionOf(project.id, 'Sprint X');
    const y = await projectionOf(project.id, 'Sprint Y');
    const z = await projectionOf(project.id, 'Sprint Z');

    expect(x.extIds).toEqual(['M-9']);
    expect(y.tickets).toBe(2);
    expect(y.storyPoints).toBe(9);
    expect(z.tickets).toBe(1);
  });
});

describe('replay', () => {
  it('restores the exact prior state when an import is deleted', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(BASE_ROWS));

    const before = await projectionOf(project.id, SPRINT);

    const second = await importFile(
      project,
      await buildAzureWorkbook([{ id: 'T-9', state: 'Done', effort: 13, iteration: SPRINT }]),
      { conflictStrategy: 'merge' }
    );

    const during = await projectionOf(project.id, SPRINT);
    expect(during.tickets).toBe(5);
    expect(during.storyPoints).toBe(33);

    // Un-merging a single file is only definable by replaying the rest, which is why the ledger exists.
    await deleteImport(second.imp!.id);

    const after = await projectionOf(project.id, SPRINT);
    expect(after.extIds).toEqual(before.extIds);
    expect(after.tickets).toBe(4);
    expect(after.storyPoints).toBe(20);
  });

  it('restores an overwritten value when the overwriting import is deleted', async () => {
    const project = await newProject();
    await importFile(project, await buildAzureWorkbook(BASE_ROWS));

    const reestimated = BASE_ROWS.map(r => (r.id === 'T-2' ? { ...r, effort: 8 } : r));
    const second = await importFile(project, await buildAzureWorkbook(reestimated), {
      conflictStrategy: 'merge',
    });

    expect((await projectionOf(project.id, SPRINT)).storyPoints).toBe(25);

    await deleteImport(second.imp!.id);

    const after = await projectionOf(project.id, SPRINT);
    expect(after.byId.get('T-2')!.storyPoints).toBe(3);
    expect(after.storyPoints).toBe(20);
  });
});

describe('sprint rename and merge', () => {
  it('folds two sprints into one and rebuilds the projection', async () => {
    const project = await newProject();

    await importFile(
      project,
      await buildAzureWorkbook([
        { id: 'R-1', state: 'Done', effort: 5, iteration: 'Sprint 1' },
        { id: 'R-2', state: 'New', effort: 3, iteration: 'Sprint 01' },
      ])
    );

    const result = await renameOrMergeSprints(project.id, ['Sprint 1', 'Sprint 01'], 'Sprint One');

    expect(result.rowsRelabelled).toBe(2);
    expect(result.targetSprint).toBe('Sprint One');

    const merged = await projectionOf(project.id, 'Sprint One');
    expect(merged.extIds).toEqual(['R-1', 'R-2']);
    expect(merged.storyPoints).toBe(8);

    expect((await projectionOf(project.id, 'Sprint 1')).tickets).toBe(0);
    expect((await projectionOf(project.id, 'Sprint 01')).tickets).toBe(0);
  });
});
