import { toLower } from 'lodash';
import { Project } from '../../../models/Project';
import { ExcelImport } from '../../../models/ExcelImport';
import { ExcelTicketState } from '../../../models/ExcelTicketState';
import { sprintKey, sprintLabel } from '../../datasource/excelProjectionService';

// A per-sprint delivery scorecard built directly from Excel-uploaded work items.
// Excel projects carry a flat snapshot (no changelog), so the metrics here are the
// subset derivable from the current state of each ticket: scope, completion, spillover
// and a per-developer delivery breakdown. Churn/reopen/cycle/QA-quality metrics that
// the Jira Board View reconstructs from changelogs are intentionally absent.

export interface ExcelSprintSummary {
  sprintName: string;
  start: string | null;
  end: string | null;
  ticketCount: number;
}

export interface ExcelSprintDeveloperRow {
  assignee: string; // '' is surfaced as "Unassigned" by the frontend
  spPlanned: number;
  spDone: number;
  deliveryPct: number;
  ticketCount: number;
  completedCount: number;
  bugCount: number;
}

export interface ExcelSprintScorecard {
  projectId: number;
  sprintName: string;
  start: string | null;
  end: string | null;
  sourceImportIds: number[];
  totals: {
    finalScopeSp: number;
    completedSp: number;
    deliveryPct: number; // story-point based (0 when the sprint has no SP)
    ticketDeliveryPct: number; // completed tickets / total tickets
    hasStoryPoints: boolean; // false for bug/QA sprints with no SP — use ticketDeliveryPct then
    ticketCount: number;
    completedCount: number;
    spilloverCount: number;
    spilloverSp: number;
    bugCount: number;
    unassignedCount: number;
    typeBreakdown: Array<{ type: string; count: number; sp: number }>;
  };
  developers: ExcelSprintDeveloperRow[];
  dataQuality: {
    rowsMissingSp: number;
    sprintWindowVaries: boolean;
    /** Epic/Feature rows left out of every number above. */
    containersExcluded: number;
    /** Tickets whose import was parsed under a column mapping that has since been replaced. */
    staleMappingTickets: number;
  };
}

// Current-state completion is inferred from the status string (no changelog exists).
const DEFAULT_DONE_STATUSES = ['done', 'closed', 'resolved', 'completed', 'released'];
const BUG_TYPES = ['bug', 'defect', 'sub-bug'];

// 'Feature' is aliased to Epic at import time, so accept both spellings.
const CONTAINER_TYPES = ['epic', 'feature'];

/**
 * Whether a work-item type can be a container at all. Exported so the row viewer flags exactly the
 * rows the metrics leave out -- the two must never disagree about what a container is.
 */
export const isContainerType = (type: string | undefined | null): boolean =>
  CONTAINER_TYPES.includes(norm(type));

const norm = (s: string | undefined | null): string => (s ?? '').trim().toLowerCase();
const sp = (v: number | undefined | null): number => (typeof v === 'number' && isFinite(v) ? v : 0);
const round = (n: number): number => Math.round(n * 10) / 10;

interface DedupedItem {
  item: ExcelTicketState;
  importId: number;
}

/**
 * Predicate marking Epic/Feature rows that other tickets hang off.
 *
 * Containers hold no effort of their own -- it lives on their children -- so counting them as work
 * items understates ticket delivery and, worse, inflates "Unassigned", since a container is never
 * assigned to anyone. SP-based delivery is unaffected either way: a container contributes 0 to both
 * sides of the ratio.
 *
 * Deliberately type-scoped. A plain "anything that is a parent" rule would drop real tickets --
 * a Bug can perfectly well have a sub-task hanging off it and still carry its own points.
 *
 * The parent set is built project-wide, not per sprint, so a container does not become a countable
 * ticket merely because its children were uploaded in a different sprint.
 */
function containerPredicate(all: ExcelTicketState[]): (item: ExcelTicketState) => boolean {
  const parentIds = new Set(
    all.map(i => (i.parentExtId ?? '').trim()).filter(Boolean)
  );

  return item => isContainerType(item.type) && parentIds.has((item.extId ?? '').trim());
}

class ExcelSprintBoardService {
  /**
   * Current state of every ticket in the project, straight from the projection.
   *
   * Identity is enforced by a unique index on (project_id, sprint_key, ext_id), so a ticket appears
   * exactly once per sprint no matter how many times its file was uploaded. This replaces a
   * read-time dedup that had been removed, leaving re-uploads to double-count every number below.
   */
  private async loadItems(projectId: number): Promise<DedupedItem[]> {
    const items = await ExcelTicketState.findAll({ where: { projectId } });

    return items.map(item => ({ item, importId: item.lastImportId ?? 0 }));
  }

  /**
   * How many of the counted tickets came from an import parsed under a superseded mapping.
   *
   * Counted over the same rows the metrics use, so the number the board shows is a share of what it
   * displays. Returns 0 when the project has no active mapping -- there is nothing to be stale
   * against.
   */
  private async countStaleMappingTickets(
    project: Project,
    selected: DedupedItem[],
    isContainer: (item: ExcelTicketState) => boolean
  ): Promise<number> {
    const activeMappingId = project.templateMappingId;

    if (!activeMappingId) {
      return 0;
    }

    const counted = selected.filter(d => !isContainer(d.item) && d.importId);
    const importIds = Array.from(new Set(counted.map(d => d.importId)));

    if (importIds.length === 0) {
      return 0;
    }

    const imports = (await ExcelImport.findAll({
      where: { id: importIds },
      attributes: ['id', 'templateMappingId'],
      raw: true,
    })) as unknown as Array<{ id: number; templateMappingId?: number | null }>;

    const staleImportIds = new Set(
      imports.filter(i => i.templateMappingId && i.templateMappingId !== activeMappingId).map(i => i.id)
    );

    return counted.filter(d => staleImportIds.has(d.importId)).length;
  }

  async listSprints(projectId: number): Promise<ExcelSprintSummary[]> {
    const items = await this.loadItems(projectId);
    // Containers are excluded here too, so the sprint list and the scorecard cannot disagree.
    const isContainer = containerPredicate(items.map(d => d.item));
    // Group by the stable sprint key, not a label recomputed per request.
    const groups = new Map<string, ExcelTicketState[]>();
    for (const { item } of items) {
      const key = item.sprintKey;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    }

    const summaries: ExcelSprintSummary[] = [];
    for (const [, rows] of groups) {
      const starts = (rows.map(r => r.sprintStart).filter(Boolean) as string[]) || '';
      const ends = (rows.map(r => r.sprintEnd).filter(Boolean) as string[]) || '';
      summaries.push({
        sprintName: sprintLabel(rows[0].sprintName),
        start: starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null,
        end: ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null,
        ticketCount: rows.filter(r => !isContainer(r)).length,
      });
    }

    // Newest sprint first (by start date, nulls last).
    summaries.sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''));
    return summaries;
  }

  async getScorecard(projectId: number, sprintName: string): Promise<ExcelSprintScorecard> {
    const project = await Project.findByPk(projectId);
    if (!project) throw new Error('Project not found');

    // Per-project Done statuses override the default set when configured.
    const configuredDone = project.kanbanDoneStatuses
      ? String(project.kanbanDoneStatuses)
          .split(',')
          .map((s: string) => s.trim().toLowerCase())
          .filter(Boolean)
      : [];

    const doneSet = new Set(configuredDone.length ? configuredDone : DEFAULT_DONE_STATUSES);
    const isDone = (status: string | undefined) => doneSet.has(toLower(norm(status)));
    const isBug = (type: string | undefined) => BUG_TYPES.includes(toLower(norm(type)));

    // Match on the normalised key so casing/whitespace in the requested name cannot miss a sprint.
    const wantedKey = sprintKey(sprintName);
    const all = await this.loadItems(projectId);
    const isContainer = containerPredicate(all.map(d => d.item));

    const selected = all.filter(d => d.item.sprintKey === wantedKey);
    const selectedRows = selected.map(d => d.item);
    // Containers are dropped from the metrics only. Nothing is deleted, and the row viewer still
    // lists them against the import they came from.
    const rows = selectedRows.filter(r => !isContainer(r));
    const containersExcluded = selectedRows.length - rows.length;
    const sourceImportIds = Array.from(new Set(selected.map(d => d.importId).filter(Boolean)));

    /*
     * Tickets carried in by an import that a newer column mapping has since superseded. They are
     * kept exactly as imported -- this only says so, since a mapping fix does not retroactively
     * change data that was already parsed.
     */
    const staleMappingTickets = await this.countStaleMappingTickets(project, selected, isContainer);

    // The sprint window comes from every row in the sprint, containers included -- they carry the
    // same sprint dates, and a sprint holding nothing but containers should still show its period.
    const starts = (selectedRows.map(r => r.sprintStart).filter(Boolean) as string[]) || '';
    const ends = (selectedRows.map(r => r.sprintEnd).filter(Boolean) as string[]) || '';

    // Headline totals.
    let finalScopeSp = 0,
      completedSp = 0,
      completedCount = 0,
      spilloverCount = 0,
      spilloverSp = 0;
    let bugCount = 0,
      unassignedCount = 0,
      rowsMissingSp = 0;
    const typeMap = new Map<string, { count: number; sp: number }>();
    const devMap = new Map<string, ExcelSprintDeveloperRow>();

    for (const r of rows) {
      const points = sp(r.storyPoints);
      if (r.storyPoints == null) rowsMissingSp += 1;
      const done = isDone(r.status);
      const bug = isBug(r.type);
      const assignee = (r.assigneeEmail ?? '').trim();

      finalScopeSp += points;
      if (done) {
        completedSp += points;
        completedCount += 1;
      } else {
        spilloverCount += 1;
        spilloverSp += points;
      }
      if (bug) bugCount += 1;
      if (!assignee) unassignedCount += 1;

      const typeKey = r.type?.trim() || 'Unspecified';
      const t = typeMap.get(typeKey) ?? { count: 0, sp: 0 };
      t.count += 1;
      t.sp += points;
      typeMap.set(typeKey, t);

      const dev = devMap.get(assignee) ?? {
        assignee,
        spPlanned: 0,
        spDone: 0,
        deliveryPct: 0,
        ticketCount: 0,
        completedCount: 0,
        bugCount: 0,
      };
      dev.spPlanned += points;
      dev.ticketCount += 1;
      if (done) {
        dev.spDone += points;
        dev.completedCount += 1;
      }
      if (bug) dev.bugCount += 1;
      devMap.set(assignee, dev);
    }

    const developers = Array.from(devMap.values())
      .map(d => ({
        ...d,
        spPlanned: round(d.spPlanned),
        spDone: round(d.spDone),
        deliveryPct: d.spPlanned > 0 ? round((d.spDone / d.spPlanned) * 100) : 0,
      }))
      .sort((a, b) => b.spPlanned - a.spPlanned);

    const typeBreakdown = Array.from(typeMap.entries())
      .map(([type, v]) => ({ type, count: v.count, sp: round(v.sp) }))
      .sort((a, b) => b.count - a.count);

    return {
      projectId,
      sprintName,
      start: starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null,
      end: ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null,
      sourceImportIds,
      totals: {
        finalScopeSp: round(finalScopeSp),
        completedSp: round(completedSp),
        deliveryPct: finalScopeSp > 0 ? round((completedSp / finalScopeSp) * 100) : 0,
        ticketDeliveryPct: rows.length > 0 ? round((completedCount / rows.length) * 100) : 0,
        hasStoryPoints: finalScopeSp > 0,
        ticketCount: rows.length,
        completedCount,
        spilloverCount,
        spilloverSp: round(spilloverSp),
        bugCount,
        unassignedCount,
        typeBreakdown,
      },
      developers,
      dataQuality: {
        rowsMissingSp,
        sprintWindowVaries: new Set(starts).size > 1 || new Set(ends).size > 1,
        containersExcluded,
        staleMappingTickets,
      },
    };
  }
}

export const excelSprintBoardService = new ExcelSprintBoardService();
