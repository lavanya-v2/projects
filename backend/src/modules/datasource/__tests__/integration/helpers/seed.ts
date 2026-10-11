import sequelize from '../../../../../config/connection';
import { Account } from '../../../../../models/Account';
import { ExcelImport } from '../../../../../models/ExcelImport';
import { ExcelStatusHistory } from '../../../../../models/ExcelStatusHistory';
import { ExcelTicketState } from '../../../../../models/ExcelTicketState';
import { ExcelWorkItem } from '../../../../../models/ExcelWorkItem';
import { Project } from '../../../../../models/Project';
import { ProjectSprint } from '../../../../../models/ProjectSprint';
import { TemplateMapping } from '../../../../../models/TemplateMapping';
import { applyImport, validateUpload } from '../../../excelImportService';
import { ExcelTemplate, ValidationResult } from '../../../types';

/**
 * Per-test scaffolding: a real account, project and mapping, created through the models the
 * application uses so the suite exercises the same schema constraints production does.
 */

let seq = 0;

/** Unique across a run, so `code` uniqueness cannot make one test depend on another's cleanup. */
const uniqueSuffix = (): string => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export interface SeededProject {
  project: Project;
  account: Account;
  mapping: TemplateMapping | null;
}

export interface SeedOptions {
  reportingFrequency?: 'daily' | 'weekly' | 'sprint';
  estimationType?: 'story_points' | 'hours';
  /** Field key -> customer header. Omit for a project deliberately left without a mapping. */
  mapping?: Record<string, string> | null;
  sourceHeaders?: string[];
  /** Postgres TEXT[] on the model, so pass the statuses as an array, not a comma string. */
  kanbanDoneStatuses?: string[];
}

export async function seedProject(options: SeedOptions = {}): Promise<SeededProject> {
  const suffix = uniqueSuffix();

  const account = await Account.create({
    name: `IT Account ${suffix}`,
    code: `ITACC${suffix}`.toUpperCase(),
  } as never);

  const project = await Project.create({
    accountId: account.id,
    name: `IT Project ${suffix}`,
    code: `ITPRJ${suffix}`.toUpperCase(),
    dataSourceType: 'excel',
    reportingFrequency: options.reportingFrequency ?? 'sprint',
    estimationType: options.estimationType ?? 'story_points',
    kanbanDoneStatuses: options.kanbanDoneStatuses,
  } as never);

  let mapping: TemplateMapping | null = null;

  if (options.mapping) {
    mapping = await saveMappingVersion(project, options.mapping, options.sourceHeaders);
  }

  return { project, account, mapping };
}

/**
 * Create the next mapping version, superseding the current one.
 *
 * Mirrors the transaction in adminController.saveProjectMappingTemplate. Duplicated deliberately:
 * the controller is an HTTP handler, and driving it here would mean faking req/res for something
 * the suite only needs as setup. The behaviour under test is what the mapping DOES to an import,
 * and the controller's own versioning is covered by mappingLifecycle.
 */
export async function saveMappingVersion(
  project: Project,
  values: Record<string, string>,
  sourceHeaders?: string[]
): Promise<TemplateMapping> {
  const previous = project.templateMappingId ? await TemplateMapping.findByPk(project.templateMappingId) : null;

  if (previous) {
    await previous.update({ active: false, supersededAt: new Date() });
  }

  const created = await TemplateMapping.create({
    ...values,
    projectId: project.id,
    active: true,
    version: (previous?.version ?? 0) + 1,
    sourceHeaders: sourceHeaders ?? previous?.sourceHeaders ?? null,
  } as never);

  await project.update({ templateMappingId: created.id });

  return created;
}

export interface ImportOptions {
  fileType?: 'excel' | 'csv';
  conflictStrategy?: 'merge' | 'replace';
  defaultSprintName?: string;
  requireSprint?: boolean;
  originalFilename?: string;
  reportDate?: string;
}

export interface ImportOutcome {
  validation: ValidationResult;
  imp: ExcelImport | null;
}

/**
 * Validate then apply, exactly as the upload controller does. Returns the validation result even
 * when it fails, so negative scenarios can assert on the errors rather than on a thrown exception.
 */
export async function importFile(
  project: Project,
  buffer: Buffer,
  options: ImportOptions = {}
): Promise<ImportOutcome> {
  const validation = await validateUpload(buffer, String(project.id) as ExcelTemplate, undefined, options.fileType ?? 'excel', {
    defaultSprintName: options.defaultSprintName,
    requireSprint: options.requireSprint ?? project.reportingFrequency === 'sprint',
  });

  if (!validation.ok) {
    return { validation, imp: null };
  }

  const imp = await applyImport(validation, {
    projectId: project.id,
    template: String(project.id) as ExcelTemplate,
    conflictStrategy: options.conflictStrategy ?? 'merge',
    templateMappingId: project.templateMappingId ?? undefined,
    originalFilename: options.originalFilename ?? 'fixture.xlsx',
    reportDate: options.reportDate,
  });

  return { validation, imp };
}

/**
 * Remove everything a test created. Ordered child-first; the projection and ledger are keyed on the
 * project, so they must go before it does.
 */
export async function cleanupProject(seeded: SeededProject): Promise<void> {
  const projectId = seeded.project.id;
  const importIds = (await ExcelImport.findAll({ where: { projectId }, attributes: ['id'], raw: true })).map(
    i => (i as unknown as { id: number }).id
  );

  if (importIds.length > 0) {
    await ExcelStatusHistory.destroy({ where: { importId: importIds } });
    await ExcelWorkItem.destroy({ where: { importId: importIds } });
  }

  await ExcelTicketState.destroy({ where: { projectId } });
  await ExcelImport.destroy({ where: { projectId } });
  await ProjectSprint.destroy({ where: { projectId } });
  await Project.update({ templateMappingId: null }, { where: { id: projectId } });
  await TemplateMapping.destroy({ where: { projectId } });
  await Project.destroy({ where: { id: projectId } });
  await Account.destroy({ where: { id: seeded.account.id } });
}

/** Fail loudly rather than silently seeding the development database. */
export async function assertScratchDatabase(): Promise<void> {
  const [row] = (await sequelize.query('SELECT current_database() AS db', {
    type: (sequelize.constructor as never as { QueryTypes: { SELECT: string } }).QueryTypes.SELECT as never,
  })) as unknown as Array<{ db: string }>;

  const expected = process.env.DB_NAME_TEST || 'dsr_excel_it';

  if (row.db !== expected) {
    throw new Error(
      `Integration tests are connected to "${row.db}" but expected the scratch database "${expected}". Aborting before any writes.`
    );
  }
}
