import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import { extractHeaders, MAPPABLE_FIELDS, NO_MAPPING_MESSAGE } from './excelTemplateValidator';
import { ExcelTemplate, ValidationResult } from './types';
import { aiService } from '../ai/services/aiService';
import { applyImport, deleteImport, listImportsForProject, loadImportById, validateUpload } from './excelImportService';
import { ConflictStrategy, previewImpact, renameOrMergeSprints } from './excelProjectionService';
import { checksumOf, readStoredFile, storeImportFile } from './excelFileStore';
import { buildTemplateWorkbook } from './excelTemplateBuilder';
import { isContainerType } from '../reports/services/excelSprintBoardService';
import { dsrQueue } from '../reports/queues/dsrQueue';
import { ExcelImport } from '../../models/ExcelImport';
import { ExcelWorkItem } from '../../models/ExcelWorkItem';
import { Project } from '../../models/Project';
import { ProjectSprint } from '../../models/ProjectSprint';
import { TemplateMapping } from '../../models/TemplateMapping';
import { logger } from '../../common/utils';

interface AuthRequest extends Request {
  user?: { id?: number; userId?: string };
}

const first = <T>(value: T | T[]): T => (Array.isArray(value) ? value[0] : value);

const fileType = (ext: string): 'excel' | 'csv' => (ext === 'csv' ? 'csv' : 'excel');

/**
 * Turn an internal failure into something a user can act on. Raw exception text used to be returned
 * verbatim, which told the user nothing and leaked implementation detail.
 */
function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);

  if (/no column mapping/i.test(raw)) return NO_MAPPING_MESSAGE;
  if (/ENOENT|EACCES|EROFS/.test(raw)) return 'The uploaded file could not be saved on the server. Contact support.';
  if (/Cannot apply an import that failed validation/i.test(raw)) {
    return 'The file did not pass validation, so nothing was imported.';
  }
  if (/unique|duplicate key/i.test(raw)) {
    return 'This upload conflicts with data already stored for the project. Try again, or contact support.';
  }
  if (/timeout|ECONNREFUSED/i.test(raw)) return 'The database was unreachable while importing. Please retry.';

  return `Import failed: ${raw}`;
}

/**
 * The raw reason a step failed, for messages recorded against an import rather than shown as a
 * headline error. Unlike `friendlyError`, this keeps the underlying text: a retention failure is
 * diagnosed by an admin, and "contact support" tells them nothing about which path was unwritable.
 */
function causeOf(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
}

/**
 * Sprint handling for a project. Sprint-frequency projects must have a sprint on every row -- it is
 * what ties re-uploads of the same sprint together -- and the uploader can declare one for files
 * whose export carries no Sprint column.
 */
async function sprintOptions(projectId: number, declared?: string) {
  const project = await Project.findByPk(projectId, { attributes: ['reportingFrequency'] });

  return {
    defaultSprintName: declared?.trim() || undefined,
    requireSprint: project?.reportingFrequency === 'sprint',
  };
}

async function activeMappingId(projectId: number): Promise<number | undefined> {
  const mapping = await TemplateMapping.findOne({
    where: { projectId, active: true },
    attributes: ['id'],
  });

  return mapping?.id;
}

/** Queue the daily DSR regeneration for an Excel upload. Never throws. */
async function queueDsr(projectId: number, importId: number, reportDate?: string): Promise<string | undefined> {
  if (!reportDate) {
    return undefined;
  }

  try {
    const project = await Project.findByPk(projectId, { attributes: ['code'] });

    if (!project?.code) {
      return undefined;
    }

    const job = await dsrQueue.add(
      'dsr-from-excel',
      { projectName: project.code, date: reportDate, importId },
      { jobId: `excel-${importId}` }
    );
    logger.info(`Queued DSR generation for ${project.code} on ${reportDate} (importId=${importId})`, 'ExcelImport');
    return job.id;
  } catch (e) {
    logger.error(`Failed to queue DSR for importId=${importId}`, e as Error, 'ExcelImport');
    await ExcelImport.update(
      {
        errorMessage:
          'Imported successfully, but the daily report could not be queued. Regenerate it from Daily Reports.',
      },
      { where: { id: importId } }
    );
    return undefined;
  }
}

export const excelImportController = {
  async validate(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const extension = req.params.ext as string;

      if (!['xlsx', 'xls', 'excel', 'csv'].includes(extension)) {
        res.status(400).json({ error: 'Only .xlsx, .xls and .csv files are supported' });
        return;
      }

      const template = (req.body.template as ExcelTemplate) || 'scrum';
      const dataSourceType = req.body.dataSourceType as string | undefined;
      const result = await validateUpload(req.file.buffer, template, dataSourceType, fileType(extension));
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: friendlyError(e) });
    }
  },

  /**
   * Read a sample file's headers and propose a mapping for them.
   *
   * Writes nothing and needs no project: this runs while a project is being created, before an id
   * exists. Only the header row is read, so no customer row data is involved.
   *
   * A failed AI call is not a failed request -- the headers alone are enough to map by hand, so the
   * response degrades to empty suggestions rather than an error.
   */
  async suggestMapping(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const extension = path.extname(req.file.originalname ?? '').toLowerCase();

      if (!['.xlsx', '.xls', '.csv'].includes(extension)) {
        res.status(400).json({ error: 'Only .xlsx, .xls and .csv files are supported' });
        return;
      }

      let headers: string[];

      try {
        headers = await extractHeaders(req.file.buffer, extension === '.csv' ? 'csv' : 'excel');
      } catch (e) {
        // An unreadable or header-less sample is a user problem with a user-fixable cause.
        res.status(400).json({ error: causeOf(e) });
        return;
      }

      const suggestions = await aiService.suggestColumnMapping(headers, MAPPABLE_FIELDS);

      res.json({ headers, suggestions, fields: MAPPABLE_FIELDS });
    } catch (e) {
      res.status(500).json({ error: friendlyError(e) });
    }
  },

  /**
   * Dry run: validate, then diff against the merged view so the user can see what a Merge or a
   * Replace would actually do before anything is written. Writes nothing.
   */
  async preview(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const projectId = parseInt(req.params.projectId as string, 10);

      if (isNaN(projectId)) {
        res.status(400).json({ error: 'Invalid projectId' });
        return;
      }

      const template = (req.body.template as ExcelTemplate) || 'scrum';
      const extension = req.params.ext as string;
      const sprintName = req.body.sprintName ? first(req.body.sprintName as string) : undefined;
      const dataSourceType = req.body.dataSourceType as string | undefined;
      const validation = await validateUpload(
        req.file.buffer,
        template,
        dataSourceType,
        fileType(extension),
        await sprintOptions(projectId, sprintName)
      );

      if (!validation.ok) {
        res.json({ ok: false, validation, impact: { hasCollision: false, sprints: [] } });
        return;
      }

      const impact = await previewImpact(projectId, validation.rows);
      const duplicate = await ExcelImport.findOne({
        where: { projectId, checksum: checksumOf(req.file.buffer), status: 'applied' },
        order: [['createdAt', 'DESC']],
        attributes: ['id', 'originalFilename', 'createdAt'],
      });

      res.json({
        ok: true,
        validation,
        impact,
        duplicateOf: duplicate
          ? { id: duplicate.id, filename: duplicate.originalFilename, uploadedAt: duplicate.createdAt }
          : null,
      });
    } catch (e) {
      res.status(500).json({ error: friendlyError(e) });
    }
  },

  async upload(req: AuthRequest, res: Response): Promise<void> {
    let importId: number | undefined;

    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const projectId = parseInt(req.params.projectId as string, 10);

      if (isNaN(projectId)) {
        res.status(400).json({ error: 'Invalid projectId' });
        return;
      }

      const template = (req.body.template as ExcelTemplate) || 'scrum';
      const reportDate = req.body.reportDate ? first(req.body.reportDate as string) : undefined;
      const extension = req.params.ext as string;
      const requested = req.body.conflictStrategy ? first(req.body.conflictStrategy as string) : undefined;

      if (requested && requested !== 'merge' && requested !== 'replace') {
        res.status(400).json({ error: 'conflictStrategy must be "merge" or "replace"' });
        return;
      }

      const sprintName = req.body.sprintName ? first(req.body.sprintName as string) : undefined;
      const dataSourceType = req.body.dataSourceType as string | undefined;
      const result: ValidationResult = await validateUpload(
        req.file.buffer,
        template,
        dataSourceType,
        fileType(extension),
        await sprintOptions(projectId, sprintName)
      );

      if (!result.ok) {
        res.status(400).json({ ok: false, validation: result });
        return;
      }

      // A destructive choice must be deliberate: when the target sprints already hold data the
      // client has to say which strategy the user picked, so nothing can be replaced by accident.
      const impact = await previewImpact(projectId, result.rows);

      if (impact.hasCollision && !requested) {
        res.status(409).json({
          ok: false,
          needsStrategy: true,
          impact,
          validation: result,
          error: 'This upload overlaps data already imported. Choose Merge or Replace.',
        });
        return;
      }

      const conflictStrategy = (requested as ConflictStrategy) ?? 'merge';

      const imp = await applyImport(result, {
        projectId,
        uploadedBy: req.user?.id,
        template,
        originalFilename: req.file.originalname,
        reportDate,
        conflictStrategy,
        dataSourceType,
        templateMappingId: await activeMappingId(projectId),
      });
      importId = imp.id;

      // Retain the file only once the import exists, so its name can be keyed by import id and a
      // filesystem failure cannot destroy an otherwise-valid import.
      try {
        const stored = storeImportFile(projectId, imp.id, req.file.buffer, req.file.originalname);
        await imp.update(stored);
      } catch (e) {
        logger.error(`Failed to retain uploaded file for importId=${imp.id}`, e as Error, 'ExcelImport');
        // Persist the reason, not just a sentence saying it happened. A generic message left a
        // retention failure undiagnosable after the fact -- the cause existed only in the console.
        await imp.update({
          errorMessage: `Imported successfully, but the original file could not be retained: ${causeOf(e)}`,
        });
      }

      const queuedJobId = await queueDsr(projectId, imp.id, reportDate);

      res.json({
        ok: true,
        importId: imp.id,
        mode: result.mode,
        conflictStrategy,
        queuedJobId,
        impact,
        validation: result,
      });
    } catch (e) {
      const message = friendlyError(e);
      logger.error('Excel import failed', e as Error, 'ExcelImport');

      // Leave a visible record rather than a silent 500.
      if (importId) {
        await ExcelImport.update(
          { status: 'failed', errorMessage: message, failedAt: new Date() },
          { where: { id: importId } }
        ).catch(() => undefined);
      } else if (!isNaN(parseInt(req.params.projectId as string, 10))) {
        await ExcelImport.create({
          projectId: parseInt(req.params.projectId as string, 10),
          uploadedBy: req.user?.id,
          template: (req.body.template as string) || 'scrum',
          mode: 'strict',
          status: 'failed',
          errorMessage: message,
          failedAt: new Date(),
          originalFilename: req.file?.originalname,
          rowCount: 0,
          historyCount: 0,
        } as never).catch(() => undefined);
      }

      res.status(500).json({ ok: false, error: message });
    }
  },

  /** Re-apply a retained file against the CURRENT mapping — the remedy after fixing a mapping. */
  async resubmit(req: AuthRequest, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string, 10);
      const id = parseInt(req.params.id as string, 10);
      const original = await ExcelImport.findOne({ where: { id, projectId } });

      if (!original) {
        res.status(404).json({ error: 'Import not found' });
        return;
      }

      const buffer = readStoredFile(original.storagePath);

      if (!buffer) {
        res.status(410).json({
          error:
            'The original file for this import is no longer available, so it cannot be resubmitted. Upload the file again.',
        });
        return;
      }

      const extension = path.extname(original.originalFilename ?? '.xlsx').toLowerCase() === '.csv' ? 'csv' : 'excel';
      const dataSourceType = req.body.dataSourceType as string | undefined;
      const result = await validateUpload(
        buffer,
        String(projectId) as ExcelTemplate,
        dataSourceType,
        extension,
        await sprintOptions(projectId)
      );

      if (!result.ok) {
        res.status(400).json({ ok: false, validation: result });
        return;
      }

      const requested = req.body?.conflictStrategy as ConflictStrategy | undefined;
      const imp = await applyImport(result, {
        projectId,
        uploadedBy: req.user?.id,
        template: original.template,
        originalFilename: original.originalFilename,
        reportDate: original.reportDate,
        conflictStrategy: requested ?? 'merge',
        templateMappingId: await activeMappingId(projectId),
      });

      try {
        await imp.update(storeImportFile(projectId, imp.id, buffer, original.originalFilename));
      } catch {
        // Non-fatal; the import itself succeeded.
      }

      const queuedJobId = await queueDsr(projectId, imp.id, original.reportDate);

      res.json({ ok: true, importId: imp.id, mode: result.mode, queuedJobId, validation: result });
    } catch (e) {
      res.status(500).json({ error: friendlyError(e) });
    }
  },

  /** Sprints already known for the project, for the upload form's sprint picker. */
  async listSprints(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string, 10);
      const sprints = await ProjectSprint.findAll({
        where: { projectId },
        order: [
          ['startDate', 'DESC'],
          ['name', 'ASC'],
        ],
        attributes: ['id', 'name', 'startDate', 'endDate'],
      });

      res.json(sprints);
    } catch (e) {
      res.status(500).json({ error: friendlyError(e) });
    }
  },

  /** Rename a sprint, or fold several into one — used to clean up auto-generated sprint names. */
  async renameSprints(req: AuthRequest, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string, 10);
      const { from, to } = req.body ?? {};
      const fromNames: string[] = Array.isArray(from) ? from : from ? [from] : [];

      if (fromNames.length === 0 || typeof to !== 'string' || !to.trim()) {
        res.status(400).json({ error: 'Provide the sprints to rename ("from") and a target name ("to")' });
        return;
      }

      const result = await renameOrMergeSprints(projectId, fromNames, to);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: friendlyError(e) });
    }
  },

  async list(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string, 10);
      const page = parseInt(req.params.page as string);
      const limit = parseInt(req.params.limit as string);
      const offset = (page - 1) * limit;
      const imports = await listImportsForProject(projectId, limit, offset);
      /*
       * The history can now say which uploads were parsed under a mapping that has since been
       * replaced. Both values were already recorded on each import; nothing ever compared them.
       * Versions come along so the chip can read "mapping v6" rather than a row id.
       */
      const project = await Project.findByPk(projectId, { attributes: ['templateMappingId'] });
      const mappings = await TemplateMapping.findAll({
        where: { projectId },
        attributes: ['id', 'version'],
        raw: true,
      });

      const versionById = Object.fromEntries(mappings.map(m => [m.id, m.version ?? null]));

      res.json({
        imports: imports.rows.map(imp => ({
          ...imp.toJSON(),
          templateMappingVersion: versionById[imp.templateMappingId ?? -1] ?? null,
        })),
        activeTemplateMappingId: project?.templateMappingId ?? null,
        totalImports: imports.count,
      });
    } catch (e) {
      res.status(500).json({ error: friendlyError(e) });
    }
  },

  /** Paginated view of exactly what one upload contained. */
  async rows(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string, 10);
      const id = parseInt(req.params.id as string, 10);
      const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize ?? '50'), 10) || 50));

      const imp = await ExcelImport.findOne({ where: { id, projectId } });

      if (!imp) {
        res.status(404).json({ error: 'Import not found' });
        return;
      }

      const { count, rows } = await ExcelWorkItem.findAndCountAll({
        where: { importId: id },
        order: [['id', 'ASC']],
        offset: (page - 1) * pageSize,
        limit: pageSize,
      });

      // The parent set spans the whole import, not just this page, so a container is flagged
      // consistently however the rows are paginated.
      const parents = (await ExcelWorkItem.findAll({
        where: { importId: id },
        attributes: ['parentExtId'],
        raw: true,
      })) as unknown as Array<{ parentExtId?: string | null }>;

      const parentIds = new Set(parents.map(p => (p.parentExtId ?? '').trim()).filter(Boolean));

      res.json({
        import: imp,
        page,
        pageSize,
        total: count,
        rows: rows.map(r => ({
          ...r.toJSON(),
          // Excluded from the metrics -- effort sits on the children -- but still listed here.
          isContainer: isContainerType(r.type) && parentIds.has((r.extId ?? '').trim()),
        })),
        validationReport: imp.validationReport ?? null,
      });
    } catch (e) {
      res.status(500).json({ error: friendlyError(e) });
    }
  },

  /** Download the file exactly as it was uploaded. */
  async downloadFile(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string, 10);
      const id = parseInt(req.params.id as string, 10);
      const imp = await ExcelImport.findOne({ where: { id, projectId } });

      if (!imp) {
        res.status(404).json({ error: 'Import not found' });
        return;
      }

      if (!imp.storagePath || !fs.existsSync(imp.storagePath)) {
        res.status(410).json({
          error: 'The original file for this import was not retained. Files are kept for uploads made from now on.',
        });
        return;
      }

      const filename = imp.originalFilename || `import-${imp.id}${path.extname(imp.storagePath)}`;
      res.setHeader('Content-Type', imp.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
      fs.createReadStream(imp.storagePath).pipe(res);
    } catch (e) {
      res.status(500).json({ error: friendlyError(e) });
    }
  },

  async get(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string, 10);
      const src = await loadImportById(id);

      if (!src) {
        res.status(404).json({ error: 'Import not found' });
        return;
      }

      res.json(src);
    } catch (e) {
      res.status(500).json({ error: friendlyError(e) });
    }
  },

  async delete(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string, 10);
      await deleteImport(id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: friendlyError(e) });
    }
  },

  async downloadTemplate(req: Request, res: Response): Promise<void> {
    try {
      const template = (req.params.template as ExcelTemplate) || 'scrum';

      if (template !== 'scrum' && template !== 'kanban') {
        res.status(400).json({ error: 'template must be scrum or kanban' });
        return;
      }

      const wb = buildTemplateWorkbook(template);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="dsr-${template}-template.xlsx"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (e) {
      res.status(500).json({ error: friendlyError(e) });
    }
  },
};
