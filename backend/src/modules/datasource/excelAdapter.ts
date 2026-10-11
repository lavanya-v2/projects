import { LaneConfig } from '../../common/laneDefaults';
import { IDataSourceAdapter } from './IDataSourceAdapter';
import { resolveSemanticLane } from './laneResolver';
import {
  ConnectionTestResult,
  DataSourceType,
  Fidelity,
  IssueQueryWindow,
  NormalizedIssue,
  NormalizedSprintRef,
  NormalizedStatusChange,
  NormalizedUser,
} from './types';
import { ExcelHistoryRow, ExcelRowParsed } from './types';

export interface ExcelImportSource {
  rows: ExcelRowParsed[];
  history: ExcelHistoryRow[];
}

export interface ExcelAdapterProject {
  id: number;
  name: string;
  laneConfig?: LaneConfig | null;
}

export class ExcelAdapter implements IDataSourceAdapter {
  readonly sourceType: DataSourceType = 'excel';

  constructor(
    private readonly project: ExcelAdapterProject,
    private readonly loadImport: () => Promise<ExcelImportSource | null>
  ) {}

  async getIssues(window: IssueQueryWindow): Promise<NormalizedIssue[]> {
    const src = await this.loadImport();
    if (!src) return [];
    const laneConfig = this.project.laneConfig ?? undefined;
    const historyByExtId = groupHistory(src.history);
    const hasHistory = src.history.length > 0;
    const fidelity: Fidelity = hasHistory ? 'full' : 'approximate';

    return src.rows
      .filter(r => inWindow(r, window))
      .map(r => this.toNormalized(r, historyByExtId.get(r.extId) ?? [], laneConfig, fidelity));
  }

  async getIssueHistory(extIds: string[]): Promise<Map<string, NormalizedStatusChange[]>> {
    const src = await this.loadImport();
    const grouped = groupHistory(src?.history ?? []);
    const out = new Map<string, NormalizedStatusChange[]>();
    for (const id of extIds) out.set(id, grouped.get(id) ?? []);
    return out;
  }

  async listSprints(limit = 10): Promise<NormalizedSprintRef[]> {
    const src = await this.loadImport();
    if (!src) return [];
    const map = new Map<string, NormalizedSprintRef>();
    for (const r of src.rows) {
      if (!r.sprintName) continue;
      if (map.has(r.sprintName)) continue;
      map.set(r.sprintName, {
        id: r.sprintName,
        name: r.sprintName,
        startDate: r.sprintStart,
        endDate: r.sprintEnd,
      });
    }
    return Array.from(map.values())
      .sort((a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0))
      .slice(0, limit);
  }

  async resolveUser(email: string): Promise<NormalizedUser | null> {
    const src = await this.loadImport();
    if (!src) return null;
    const match = src.rows.find(r => r.assigneeEmail.toLowerCase() === email.toLowerCase());
    if (!match) return null;
    return { extId: match.assigneeEmail, name: match.assigneeEmail, email: match.assigneeEmail };
  }

  async discoverStates(): Promise<string[]> {
    const src = await this.loadImport();
    if (!src) return [];
    const set = new Set<string>();
    for (const r of src.rows) if (r.status) set.add(r.status);
    return Array.from(set).sort();
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const src = await this.loadImport();
    if (!src) {
      return { ok: false, message: 'No Excel import available for this project' };
    }
    return {
      ok: true,
      message: `Latest import has ${src.rows.length} rows and ${src.history.length} history entries`,
      discoveredStates: Array.from(new Set(src.rows.map(r => r.status))).sort(),
    };
  }

  private toNormalized(
    r: ExcelRowParsed,
    history: NormalizedStatusChange[],
    laneConfig: LaneConfig | undefined,
    baselineFidelity: Fidelity
  ): NormalizedIssue {
    const effectiveHistory =
      history.length > 0
        ? history
        : r.statusChangedOn
          ? [
              {
                from: '',
                to: r.status,
                at: r.statusChangedOn,
              },
            ]
          : [];
    const fidelity: Fidelity = history.length > 0 ? 'full' : baselineFidelity;
    return {
      extId: r.extId,
      title: r.title,
      type: r.type,
      state: r.status,
      semanticLane: laneConfig ? resolveSemanticLane(r.status, laneConfig) : undefined,
      priority: r.priority,
      assignee: {
        extId: r.assigneeEmail,
        name: r.assigneeEmail,
        email: r.assigneeEmail,
      },
      parentExtId: r.parentExtId,
      storyPoints: r.storyPoints,
      sprintRef: r.sprintName
        ? {
            id: r.sprintName,
            name: r.sprintName,
            startDate: r.sprintStart,
            endDate: r.sprintEnd,
          }
        : undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      dueDate: undefined,
      labels: r.labels,
      statusHistory: effectiveHistory,
      comments: undefined,
      fidelity,
    };
  }
}

function groupHistory(rows: ExcelHistoryRow[]): Map<string, NormalizedStatusChange[]> {
  const map = new Map<string, NormalizedStatusChange[]>();
  for (const h of rows) {
    const list = map.get(h.extId) ?? [];
    list.push({
      from: h.fromStatus,
      to: h.toStatus,
      at: h.changedOn,
      byEmail: h.changedByEmail,
    });
    map.set(h.extId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());
  return map;
}

function inWindow(r: ExcelRowParsed, window: IssueQueryWindow): boolean {
  if (window.fromDate && r.updatedAt < window.fromDate) return false;
  if (window.toDate && r.updatedAt > window.toDate) return false;
  if (window.sprintRef != null && r.sprintName && String(window.sprintRef) !== r.sprintName) {
    return false;
  }
  return true;
}
