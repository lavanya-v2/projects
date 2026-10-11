import { Transaction } from 'sequelize';
import { ExcelImport } from '../../models/ExcelImport';
import { ExcelWorkItem } from '../../models/ExcelWorkItem';
import { ExcelTicketState } from '../../models/ExcelTicketState';
import { ProjectSprint } from '../../models/ProjectSprint';
import sequelize from '../../config/connection';

/**
 * Ledger -> projection.
 *
 * excel_work_items is an immutable per-import ledger: exactly what each uploaded file contained.
 * excel_ticket_state is the merged current state, keyed (project_id, sprint_key, ext_id).
 *
 * The projection is always derivable by replaying the ledger, which is what makes every awkward
 * case tractable: deleting an import, re-uploading a sprint, or choosing Replace over Merge are all
 * just "replay with these inputs" rather than destructive one-off writes.
 */

export type ConflictStrategy = 'merge' | 'replace';

export const NO_SPRINT_KEY = '__no_sprint__';
export const NO_SPRINT_LABEL = 'No Sprint';

/**
 * Normalised sprint identity. Case- and whitespace-insensitive so "Sprint 12", "sprint 12" and
 * "Sprint 12 " are one sprint rather than three.
 *
 * Must stay in sync with the SQL expression used by the sprint_key migrations.
 */
export function sprintKey(name?: string | null): string {
  const trimmed = (name ?? '').trim().toLowerCase();
  return trimmed === '' ? NO_SPRINT_KEY : trimmed;
}

/** Display label for a sprint bucket, including the stable "no sprint" bucket. */
export function sprintLabel(name?: string | null): string {
  const trimmed = (name ?? '').trim();
  return trimmed === '' ? NO_SPRINT_LABEL : trimmed;
}

/** Columns overwritten when a ticket already exists in the projection. */
const UPDATABLE_COLUMNS = [
  'lastImportId',
  'title',
  'type',
  'status',
  'priority',
  'assigneeEmail',
  'storyPoints',
  'sprintName',
  'sprintStart',
  'sprintEnd',
  'createdAtSource',
  'updatedAtSource',
  'statusChangedOn',
  'doneDate',
  'parentExtId',
  'labels',
];

function toStateRow(projectId: number, item: ExcelWorkItem) {
  return {
    projectId,
    sprintKey: item.sprintKey ?? sprintKey(item.sprintName),
    extId: item.extId,
    lastImportId: item.importId,
    title: item.title,
    type: item.type,
    status: item.status,
    priority: item.priority,
    assigneeEmail: item.assigneeEmail,
    storyPoints: item.storyPoints,
    sprintName: item.sprintName,
    sprintStart: item.sprintStart,
    sprintEnd: item.sprintEnd,
    createdAtSource: item.createdAtSource,
    updatedAtSource: item.updatedAtSource,
    statusChangedOn: item.statusChangedOn,
    doneDate: item.doneDate,
    parentExtId: item.parentExtId,
    labels: item.labels,
  };
}

/**
 * Fold one import's ledger rows into the projection.
 *
 * merge   - upsert on (project, sprint, ext_id). Tickets absent from the file are left alone, so a
 *           partial export cannot silently delete a sprint.
 * replace - the file is the whole truth for the sprints it covers: those sprints are cleared first.
 */
export async function applyImportToProjection(
  imp: ExcelImport,
  strategy: ConflictStrategy,
  transaction: Transaction
): Promise<void> {
  const items = await ExcelWorkItem.findAll({ where: { importId: imp.id }, transaction });

  if (items.length === 0) {
    return;
  }

  if (strategy === 'replace') {
    const keys = Array.from(new Set(items.map(i => i.sprintKey ?? sprintKey(i.sprintName))));
    await ExcelTicketState.destroy({
      where: { projectId: imp.projectId, sprintKey: keys },
      transaction,
    });
  }

  await ExcelTicketState.bulkCreate(
    items.map(item => toStateRow(imp.projectId, item)),
    {
      transaction,
      updateOnDuplicate: UPDATABLE_COLUMNS as (keyof ExcelTicketState)[],
      conflictAttributes: ['projectId', 'sprintKey', 'extId'] as (keyof ExcelTicketState)[],
    } as never
  );
}

/**
 * Rebuild a project's projection from scratch by replaying every applied import in upload order.
 *
 * Used after a delete, after a sprint rename/merge, or any time the projection could have drifted.
 * Because this is deterministic, the projection never needs to be repaired by hand.
 */
export async function rebuildProjection(projectId: number, transaction?: Transaction): Promise<number> {
  const run = async (trx: Transaction) => {
    await ExcelTicketState.destroy({ where: { projectId }, transaction: trx });

    const imports = await ExcelImport.findAll({
      where: { projectId, status: 'applied' },
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ],
      transaction: trx,
    });

    for (const imp of imports) {
      await applyImportToProjection(imp, (imp.conflictStrategy as ConflictStrategy) ?? 'merge', trx);
    }

    return imports.length;
  };

  return transaction ? run(transaction) : sequelize.transaction(run);
}

/**
 * Rename a sprint, or fold several sprints into one.
 *
 * This is how the `Custom Sprint - <timestamp>` buckets left behind by the old synthesised-sprint
 * behaviour get consolidated into real sprint names without hand-written SQL. The ledger is
 * relabelled and the projection replayed, so the merged view stays derivable.
 */
export async function renameOrMergeSprints(
  projectId: number,
  fromNames: string[],
  toName: string
): Promise<{ rowsRelabelled: number; targetSprint: string }> {
  const target = toName.trim();

  if (!target) {
    throw new Error('A target sprint name is required');
  }

  const fromKeys = fromNames.map(sprintKey).filter(key => key !== sprintKey(target));

  if (fromKeys.length === 0) {
    return { rowsRelabelled: 0, targetSprint: target };
  }

  return sequelize.transaction(async trx => {
    // Work items reach their project through the import, so scope by this project's import ids.
    const imports = await ExcelImport.findAll({
      where: { projectId },
      attributes: ['id'],
      transaction: trx,
    });

    if (imports.length === 0) {
      return { rowsRelabelled: 0, targetSprint: target };
    }

    const [rowsRelabelled] = await ExcelWorkItem.update(
      { sprintName: target, sprintKey: sprintKey(target) },
      {
        where: { importId: imports.map(i => i.id), sprintKey: fromKeys },
        transaction: trx,
      }
    );

    // Keep the sprint catalogue consistent with the relabelled ledger.
    await ProjectSprint.destroy({
      where: { projectId, name: fromNames.filter(n => n.trim() !== target) },
      transaction: trx,
    });

    await rebuildProjection(projectId, trx);

    return { rowsRelabelled, targetSprint: target };
  });
}

export interface SprintImpact {
  sprintKey: string;
  sprintName: string;
  /** Tickets already in this sprint before the upload. */
  existingTickets: number;
  existingStoryPoints: number;
  /** Rows in the uploaded file for this sprint. */
  incomingRows: number;
  /** Rows that would overwrite an existing ticket. */
  updates: number;
  /** Rows that are new to this sprint. */
  additions: number;
  /** Tickets present in this sprint but NOT in the uploaded file. */
  missing: number;
  totalsAfter: {
    merge: { tickets: number; storyPoints: number };
    replace: { tickets: number; storyPoints: number };
  };
}

export interface ImpactReport {
  /** True when any target sprint already holds data, i.e. a strategy choice is required. */
  hasCollision: boolean;
  sprints: SprintImpact[];
}

interface IncomingRow {
  extId: string;
  sprintName?: string;
  storyPoints?: number;
}

const points = (value?: number | null): number => (typeof value === 'number' && isFinite(value) ? value : 0);
const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * Diff an about-to-be-applied file against the current projection, without writing anything.
 *
 * This is what backs the pre-upload confirmation. The number that actually decides Merge vs Replace
 * is `missing` -- tickets that exist today but are absent from the new file -- so it is always
 * reported, including when it is zero.
 */
export async function previewImpact(projectId: number, rows: IncomingRow[]): Promise<ImpactReport> {
  const byKey = new Map<string, { name: string; rows: IncomingRow[] }>();

  for (const row of rows) {
    const key = sprintKey(row.sprintName);
    const bucket = byKey.get(key) ?? { name: sprintLabel(row.sprintName), rows: [] };
    bucket.rows.push(row);
    byKey.set(key, bucket);
  }

  if (byKey.size === 0) {
    return { hasCollision: false, sprints: [] };
  }

  const existing = await ExcelTicketState.findAll({
    where: { projectId, sprintKey: Array.from(byKey.keys()) },
    attributes: ['sprintKey', 'extId', 'storyPoints'],
  });

  const existingByKey = new Map<string, Map<string, number>>();
  for (const row of existing) {
    const bucket = existingByKey.get(row.sprintKey) ?? new Map<string, number>();
    bucket.set(row.extId, points(row.storyPoints));
    existingByKey.set(row.sprintKey, bucket);
  }

  const sprints: SprintImpact[] = [];

  for (const [key, bucket] of byKey) {
    const current = existingByKey.get(key) ?? new Map<string, number>();

    // Last occurrence wins within a single file, matching the importer.
    const incoming = new Map<string, number>();
    for (const row of bucket.rows) {
      incoming.set(row.extId, points(row.storyPoints));
    }

    let updates = 0;
    let additions = 0;
    let incomingSp = 0;

    for (const [extId, sp] of incoming) {
      incomingSp += sp;
      if (current.has(extId)) {
        updates += 1;
      } else {
        additions += 1;
      }
    }

    let missing = 0;
    let missingSp = 0;

    for (const [extId, sp] of current) {
      if (!incoming.has(extId)) {
        missing += 1;
        missingSp += sp;
      }
    }

    const existingSp = Array.from(current.values()).reduce((sum, sp) => sum + sp, 0);

    sprints.push({
      sprintKey: key,
      sprintName: bucket.name,
      existingTickets: current.size,
      existingStoryPoints: round(existingSp),
      incomingRows: incoming.size,
      updates,
      additions,
      missing,
      totalsAfter: {
        merge: { tickets: incoming.size + missing, storyPoints: round(incomingSp + missingSp) },
        replace: { tickets: incoming.size, storyPoints: round(incomingSp) },
      },
    });
  }

  sprints.sort((a, b) => a.sprintName.localeCompare(b.sprintName));

  return { hasCollision: sprints.some(s => s.existingTickets > 0), sprints };
}
