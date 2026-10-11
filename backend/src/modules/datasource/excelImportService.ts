import { ExcelImport } from '../../models/ExcelImport';
import { ExcelWorkItem } from '../../models/ExcelWorkItem';
import { ExcelStatusHistory } from '../../models/ExcelStatusHistory';
import { ProjectSprint } from '../../models/ProjectSprint';
import sequelize from '../../config/connection';
import { validateCsvBuffer, validateExcelBuffer } from './excelTemplateValidator';
import { ExcelTemplate, ValidateOptions, ValidationResult } from './types';
import { ExcelImportSource } from './excelAdapter';
import { applyImportToProjection, ConflictStrategy, rebuildProjection, sprintKey } from './excelProjectionService';
import { removeStoredFile } from './excelFileStore';
import { Transaction } from 'sequelize';

export interface ApplyImportOptions {
  projectId: number;
  uploadedBy?: number;
  template: ExcelTemplate;
  originalFilename?: string;
  reportDate?: string;
  /** How to fold this file into the merged view. Defaults to the non-destructive option. */
  conflictStrategy?: ConflictStrategy;
  dataSourceType?: string;
  templateMappingId?: number;
}

interface ExcelImportData {
  rows: ExcelImport[];
  count: number;
}

export async function validateUpload(
  buffer: Buffer,
  template: ExcelTemplate,
  dataSourceType: string | undefined,
  fileType: 'excel' | 'csv' = 'excel',
  options: ValidateOptions = {}
): Promise<ValidationResult> {
  if (fileType === 'csv') {
    return validateCsvBuffer(buffer, template, dataSourceType, options);
  }
  return validateExcelBuffer(buffer, template, dataSourceType, options);
}

const getCustomSprintName = (dataSourceType: string | undefined): string => {
  const customSprintName = 'custom_sprint';
  if (dataSourceType === 'custom-excel') {
    return `${customSprintName}_${new Date().toISOString().split('T')[0]}`;
  }
  return '';
};

export async function applyImport(result: ValidationResult, opts: ApplyImportOptions): Promise<ExcelImport> {
  if (!result.ok) {
    throw new Error('Cannot apply an import that failed validation');
  }
  const periodStart = minDate(result.rows.map(r => r.sprintStart).filter(isDate));
  const periodEnd = maxDate(result.rows.map(r => r.sprintEnd).filter(isDate));
  const conflictStrategy: ConflictStrategy = opts.conflictStrategy ?? 'merge';
  const generatedSprintName = getCustomSprintName(opts.dataSourceType);

  return await sequelize.transaction(async trx => {
    const imp = await ExcelImport.create(
      {
        projectId: opts.projectId,
        uploadedBy: opts.uploadedBy,
        template: opts.template,
        mode: result.mode,
        status: 'applied',
        conflictStrategy,
        templateMappingId: opts.templateMappingId,
        reportDate: Array.isArray(opts.reportDate) ? opts.reportDate[0] : opts.reportDate,
        periodStart: periodStart ? toDateOnly(periodStart) : undefined,
        periodEnd: periodEnd ? toDateOnly(periodEnd) : undefined,
        rowCount: result.rows.length,
        historyCount: result.history.length,
        hasHistory: result.history.length > 0,
        validationReport: { coercions: result.coercions, errors: result.errors },
        originalFilename: opts.originalFilename,
      },
      { transaction: trx }
    );

    const mappedRows = result.rows.map(r => {
      const sprintName = opts.dataSourceType === 'custom-excel' ? generatedSprintName : r.sprintName;
      const sprintStart = r.sprintStart ? toDateOnly(r.sprintStart) : undefined;
      const sprintEnd = r.sprintEnd ? toDateOnly(r.sprintEnd) : undefined;

      return {
        importId: imp.id,
        extId: r.extId,
        title: r.title,
        type: opts.dataSourceType === 'custom-excel' && !r.type ? 'Task' : r.type,
        status: opts.dataSourceType === 'custom-excel' && !r.status ? 'Done' : r.status,
        priority: r.priority,
        assigneeEmail: r.assigneeEmail,
        storyPoints: r.storyPoints,
        sprintName,
        sprintKey: sprintKey(sprintName),
        sprintStart,
        sprintEnd,
        createdAtSource: r.createdAt,
        updatedAtSource: r.updatedAt,
        statusChangedOn: r.statusChangedOn,
        doneDate: r.doneDate,
        parentExtId: r.parentExtId,
        labels: r.labels,
      };
    });

    if (mappedRows.length > 0) {
      await ExcelWorkItem.bulkCreate(mappedRows, { transaction: trx });
    }

    if (result.history.length > 0) {
      await ExcelStatusHistory.bulkCreate(
        result.history.map(h => ({
          importId: imp.id,
          extId: h.extId,
          fromStatus: h.fromStatus,
          toStatus: h.toStatus,
          changedOn: h.changedOn,
          changedByEmail: h.changedByEmail,
        })),
        { transaction: trx }
      );
    }
    await upsertSprintsFromRows(opts.projectId, mappedRows, trx);

    // Ledger is written; fold it into the merged view the scorecard reads.
    await applyImportToProjection(imp, conflictStrategy, trx);

    return imp;
  });
}

async function upsertSprintsFromRows(
  projectId: number,
  rows: Array<{ sprintName?: string; sprintStart?: string; sprintEnd?: string }>,
  trx: Transaction
): Promise<void> {
  const byName = new Map<string, { name: string; startDate?: string; endDate?: string }>();
  for (const r of rows) {
    if (!r.sprintName) continue;
    const existing = byName.get(r.sprintName);

    const startDate = r.sprintStart || existing?.startDate;
    const endDate = r.sprintEnd || existing?.endDate;
    byName.set(r.sprintName, { name: r.sprintName, startDate, endDate });
  }
  if (byName.size === 0) return;

  for (const sprint of byName.values()) {
    const [row] = await ProjectSprint.findOrCreate({
      where: { projectId, name: sprint.name },
      defaults: {
        projectId,
        name: sprint.name,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        source: 'excel',
      },
      transaction: trx,
    });
    // Update dates if the latest upload supplies more specific values
    if (
      (sprint.startDate && row.startDate !== sprint.startDate) ||
      (sprint.endDate && row.endDate !== sprint.endDate)
    ) {
      await row.update(
        {
          startDate: sprint.startDate ?? row.startDate,
          endDate: sprint.endDate ?? row.endDate,
        },
        { transaction: trx }
      );
    }
  }
}

export async function loadLatestImport(projectId: number): Promise<ExcelImportSource | null> {
  const imp = await ExcelImport.findOne({
    where: { projectId, status: 'applied' },
    order: [['createdAt', 'DESC']],
  });
  if (!imp) return null;
  return await loadImportById(imp.id);
}

export async function loadImportById(importId: number): Promise<ExcelImportSource | null> {
  const imp = await ExcelImport.findByPk(importId);
  if (!imp) return null;

  const items = await ExcelWorkItem.findAll({ where: { importId } });
  const history = await ExcelStatusHistory.findAll({ where: { importId } });

  return {
    rows: items.map(i => ({
      extId: i.extId,
      title: i.title,
      type: i.type,
      status: i.status,
      priority: i.priority,
      assigneeEmail: i.assigneeEmail,
      storyPoints: i.storyPoints,
      sprintName: i.sprintName,
      sprintStart: i.sprintStart ? new Date(i.sprintStart) : undefined,
      sprintEnd: i.sprintEnd ? new Date(i.sprintEnd) : undefined,
      createdAt: i.createdAtSource,
      updatedAt: i.updatedAtSource,
      statusChangedOn: i.statusChangedOn,
      doneDate: i.doneDate,
      parentExtId: i.parentExtId,
      labels: i.labels,
    })),
    history: history.map(h => ({
      extId: h.extId,
      fromStatus: h.fromStatus ?? '',
      toStatus: h.toStatus,
      changedOn: h.changedOn,
      changedByEmail: h.changedByEmail,
    })),
  };
}

export async function listImportsForProject(projectId: number, limit: number, offset: number): Promise<ExcelImportData> {
  const excelImports = await ExcelImport.findAndCountAll({
    where: { projectId },
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });
  const response = { rows: excelImports.rows, count: excelImports.count };
  return response;
}

/**
 * Removing an import drops its ledger rows and replays what remains, so the merged view returns to
 * exactly the state it would have had if the upload had never happened. Without the replay this
 * would be undefined -- there is no way to "un-merge" a single file's contribution.
 */
export async function deleteImport(importId: number): Promise<void> {
  await sequelize.transaction(async trx => {
    const imp = await ExcelImport.findByPk(importId, { transaction: trx });

    if (!imp) {
      return;
    }

    const { projectId, storagePath } = imp;
    await ExcelImport.destroy({ where: { id: importId }, transaction: trx });
    await rebuildProjection(projectId, trx);
    removeStoredFile(storagePath);
  });
}

function isDate(d: Date | undefined): d is Date {
  return d instanceof Date && !isNaN(d.getTime());
}

function minDate(arr: Date[]): Date | undefined {
  if (arr.length === 0) return undefined;
  return new Date(Math.min(...arr.map(d => d.getTime())));
}

function maxDate(arr: Date[]): Date | undefined {
  if (arr.length === 0) return undefined;
  return new Date(Math.max(...arr.map(d => d.getTime())));
}

function toDateOnly(d: Date): string {
  return d.toISOString().split('T')[0];
}

// Exposed for wiring into dataSourceFactory
export const excelLoader = (projectId: number) => loadLatestImport(projectId);
