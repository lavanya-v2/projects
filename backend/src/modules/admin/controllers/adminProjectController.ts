/* eslint-disable @typescript-eslint/no-unused-vars */
import { Request, Response } from 'express';
import { Account } from '../../../models/Account';
import { Project } from '../../../models/Project';
import { TeamMember } from '../../../models/TeamMember';
import { AccountTeamMember } from '../../../models/AccountTeamMember';
import { UserPermission } from '../../../models/UserPermission';
import { JiraService } from '../../jira/services/jiraService';
import { logger } from '../../../common/utils/logger';
import { TemplateMapping } from '../../../models/TemplateMapping';
import sequelize from '../../../config/connection';
import path from 'path';
import { extractHeaders, MAPPABLE_FIELDS, resolveMappingKey } from '../../datasource/excelTemplateValidator';
import { storeMappingSample } from '../../datasource/excelFileStore';
import { Op, Sequelize, WhereOptions } from 'sequelize';
import { validateKanbanCadence } from '../../reports/services/kanbanCycleService';
import { LaneConfig } from '../../../common/laneDefaults';
import { getAccessibleProjectIds, getAccessibleProjectIdsInAccount } from '../../../common/projectAccess';

interface ProjectData {
  name: string;
  code: string;
  accountId: number;
  dataSourceType: 'jira' | 'azure_devops' | 'excel' | 'custom-excel';
  jiraBoardId: number;
  jiraName: string;
  jiraBaseUrl: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  jiraLaneConfig?: LaneConfig;
  azureOrgUrl?: string;
  azureProject?: string;
  azureTeam?: string;
  azurePat?: string;
  azureBoardId?: string;
  isSharedTeam: boolean;
  isKanbanProject: boolean;
  piiRedactionEnabled: boolean;
  kanbanDoneStatuses?: string[];
  kanbanCycleEnabled: boolean;
  kanbanCycleDays?: number | null;
  kanbanCycleStrideDays?: number | null;
  kanbanCycleAnchorDate?: string | null;
  kanbanAutoSync: boolean;
  estimationType: 'story_points' | 'hours';
  hoursSource?: 'time_tracking' | 'custom_field' | null;
  hoursFieldName?: string | null;
  defaultDailyCapacityHours?: number | null;
  reportingFrequency: 'daily' | 'weekly' | 'sprint';
  isActive: boolean;
}

/**
 * Mirrors the backfill rule in migration 20260814000002 exactly -- the write
 * path must keep delivery_model in agreement with is_kanban_project /
 * kanban_cycle_enabled going forward, or every project created/edited after
 * that migration would silently diverge from it (deliveryModel stuck at the
 * column default 'sprint' while isKanbanProject=true), breaking every call
 * site that has migrated to the delivery-period seam. See the Kanban
 * delivery-models design doc.
 */

function deriveDeliveryModel(
  isKanbanProject: boolean,
  kanbanCycleEnabled: boolean
): 'sprint' | 'cadence' | 'continuous' {
  if (!isKanbanProject) return 'sprint';
  return kanbanCycleEnabled ? 'cadence' : 'continuous';
}

interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    role?: string;
    roleName?: string;
  };
}

interface AssignProjectType {
  id?: number;
  projectId: number;
  role: string;
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function adminGetProjects(req: AuthenticatedRequest, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'User not authenticated' });

    if (user.role === 'SUPERUSER') {
      const projects = await Project.findAll({
        include: [
          {
            association: 'account',
            attributes: ['id', 'name'],
          },
        ],
        order: [['name', 'ASC']],
      });
      return res.json({
        success: true,
        data: projects,
      });
    }
    const permissions = await getAccessibleProjectIds(user.id);

    const projects = await Project.findAll({
      where: {
        id: { [Op.in]: Array.from(permissions) },
      },
      include: [
        {
          association: 'account',
          attributes: ['id', 'name'],
        },
      ],
      order: [['name', 'ASC']],
    });

    return res.json({
      success: true,
      data: projects,
    });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function adminGetAccountProjects(req: AuthenticatedRequest, res: Response) {
  try {
    const accountId = parseInt(req.params.id as string);
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'User not authenticated' });

    const page = Number(req.query.pageNumber) || 1;
    const limit = Number(req.query.pageLimit) || 10;
    const offset = (page - 1) * limit;
    if (accountId) {
      if (user.role === 'SUPERUSER') {
        const projects = await Project.findAndCountAll({
          attributes: {
            include: [
              [Sequelize.fn('COUNT', Sequelize.fn('DISTINCT', Sequelize.col('teamMembers.id'))), 'memberCounts'],
            ],
          },
          include: [
            {
              model: AccountTeamMember,
              as: 'teamMembers',
              attributes: [],
              required: false,
            },
          ],
          where: { accountId: accountId },
          subQuery: false,
          group: ['Project.id', 'Project.name', 'teamMembers.project_id'],
          order: [['name', 'ASC']],
          limit,
          offset,
        });
        const totalProjectsCount = Array.isArray(projects.count) ? projects.count.length : projects.count;

        return res.json({ success: true, data: projects.rows, total: totalProjectsCount });
      }
      const permissions = await getAccessibleProjectIdsInAccount(user.id, accountId);

      const projectIdsArray = Array.from(permissions);
      const projects = await Project.findAndCountAll({
        attributes: {
          include: [[Sequelize.fn('COUNT', Sequelize.fn('DISTINCT', Sequelize.col('teamMembers.id'))), 'memberCounts']],
        },
        include: [
          {
            model: AccountTeamMember,
            as: 'teamMembers',
            attributes: [],
            required: false,
          },
        ],
        where: { id: projectIdsArray },
        subQuery: false,
        group: ['Project.id', 'Project.name', 'teamMembers.project_id'],
        order: [['name', 'ASC']],
        limit,
        offset,
      });
      const totalProjectsCount = Array.isArray(projects.count) ? projects.count.length : projects.count;
      return res.json({
        success: true,
        data: projects.rows,
        total: totalProjectsCount,
      });
    } else {
      return res.status(400).json({ success: false, message: 'Please provide account Id' });
    }
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(422).json({ success: false, message: err.message });
  }
}

export async function adminGetProject(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id as string);
    const project = await Project.findByPk(id, {
      include: [{ model: Account, attributes: ['id', 'name', 'code'] }],
    });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    return res.json({ success: true, data: project });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(500).json({ success: false, message: err.message });
  }
}

// Reporting cadence is only meaningful for Excel projects; jira/azure stay 'daily'.
// Coerce any client input to one of the three allowed values.
function normalizeReportingFrequency(value: unknown, isExcel: boolean): 'daily' | 'weekly' | 'sprint' {
  if (!isExcel) return 'daily';
  return value === 'sprint' ? 'sprint' : value === 'weekly' ? 'weekly' : 'daily';
}

const DEV_ASSISTANT_TOOLS = ['claude', 'copilot', 'openai', 'cursor', 'none'] as const;
type DevAssistantTool = (typeof DEV_ASSISTANT_TOOLS)[number];
/** Only the 5 known values pass through; anything else (or omitted) is 'none' —
 * a project must be explicitly opted in, never silently default to Claude. */
function normalizeDevAssistantTool(value: unknown): DevAssistantTool {
  return (DEV_ASSISTANT_TOOLS as readonly string[]).includes(value as string) ? (value as DevAssistantTool) : 'none';
}

export async function adminCreateProject(req: AuthenticatedRequest, res: Response) {
  try {
    const {
      name,
      code,
      accountId,
      dataSourceType,
      jiraBoardId,
      jiraName,
      jiraBaseUrl,
      jiraEmail,
      jiraApiToken,
      jiraLaneConfig,
      azureOrgUrl,
      azureProject,
      azureTeam,
      azurePat,
      azureBoardId,
      isSharedTeam,
      isKanbanProject,
      sprintAssignmentModel,
      piiRedactionEnabled,
      kanbanDoneStatuses,
      kanbanCycleEnabled,
      kanbanCycleDays,
      kanbanCycleStrideDays,
      kanbanCycleAnchorDate,
      kanbanAutoSync,
      estimationType,
      hoursSource,
      hoursFieldName,
      defaultDailyCapacityHours,
      reportingFrequency,
      isActive,
      devAssistantAiTool,
    } = req.body;
    const userId = req.user?.id;
    const userRole = req.user?.roleName;

    const source = (dataSourceType ?? 'jira') as 'jira' | 'azure_devops' | 'excel' | 'custom-excel';

    if (!name || !code || !accountId) {
      return res.status(400).json({ success: false, message: 'name, code, accountId are required' });
    }
    if (source === 'jira' && (!jiraBoardId || !jiraBaseUrl)) {
      return res
        .status(400)
        .json({ success: false, message: 'jiraBoardId and jiraBaseUrl are required for Jira projects' });
    }
    if (source === 'azure_devops' && (!azureOrgUrl || !azureProject || !azurePat)) {
      return res.status(400).json({
        success: false,
        message: 'azureOrgUrl, azureProject, azurePat are required for Azure DevOps projects',
      });
    }
    // Server-side mirror of the form's cadence check — the client-side check
    // alone lets a stride < window pair reach the API (curl, Postman, a future
    // UI bug) and save silently: generateCycles() would then just return an
    // empty list everywhere with no indication why.
    if (isKanbanProject) {
      const cadenceCheck = validateKanbanCadence(
        Number(kanbanCycleDays) || null,
        Number(kanbanCycleStrideDays) || null
      );
      if (!cadenceCheck.valid) {
        return res.status(400).json({ success: false, message: cadenceCheck.error });
      }
    }

    // Excel projects are sprint-only in Phase 1 — Kanban and Shared Team are not supported yet.
    // Force them off regardless of body input so curl/Postman can't bypass the UI guard.
    const isExcel = source === 'excel' || source === 'custom-excel';
    const result = await sequelize.transaction(async t => {
      const project = await Project.create({
        name,
        code,
        accountId,
        dataSourceType: source,
        jiraBoardId: source === 'jira' ? jiraBoardId : null,
        jiraName: source === 'jira' ? jiraName || name : null,
        jiraBaseUrl: source === 'jira' ? jiraBaseUrl : null,
        jiraEmail,
        jiraApiToken,
        jiraLaneConfig,
        azureOrgUrl: source === 'azure_devops' ? azureOrgUrl : null,
        azureProject: source === 'azure_devops' ? azureProject : null,
        azureTeam: source === 'azure_devops' ? azureTeam : null,
        azurePat: source === 'azure_devops' ? azurePat : null,
        azureBoardId: source === 'azure_devops' ? azureBoardId : null,
        isSharedTeam: isExcel ? false : !!isSharedTeam,
        isKanbanProject: isExcel ? false : !!isKanbanProject,
        deliveryModel: deriveDeliveryModel(isExcel ? false : !!isKanbanProject, isExcel ? false : !!kanbanCycleEnabled),
        // Meaningless for Kanban/Excel (no sprintBurndown concept there) -- force
        // 'planned' regardless of client input, same pattern as isSharedTeam above.
        sprintAssignmentModel:
          isExcel || !!isKanbanProject ? 'planned' : sprintAssignmentModel === 'on_the_go' ? 'on_the_go' : 'planned',
        // Default ON when the client omits the field, so a project is never
        // silently created with redaction off.
        piiRedactionEnabled: piiRedactionEnabled === undefined ? true : !!piiRedactionEnabled,
        kanbanDoneStatuses: isExcel ? null : kanbanDoneStatuses || null,
        kanbanCycleEnabled: isExcel ? false : !!kanbanCycleEnabled,
        kanbanCycleDays: isExcel ? null : Number(kanbanCycleDays) || null,
        kanbanCycleStrideDays: isExcel ? null : Number(kanbanCycleStrideDays) || null,
        kanbanCycleAnchorDate: isExcel ? null : kanbanCycleAnchorDate || null,
        kanbanAutoSync: isExcel ? false : !!kanbanAutoSync,
        estimationType: estimationType === 'hours' ? 'hours' : 'story_points',
        hoursSource: estimationType === 'hours' ? hoursSource || 'time_tracking' : null,
        hoursFieldName: estimationType === 'hours' ? hoursFieldName || null : null,
        defaultDailyCapacityHours: estimationType === 'hours' ? Number(defaultDailyCapacityHours) || null : null,
        isActive: isActive === undefined ? true : !!isActive,
        reportingFrequency: normalizeReportingFrequency(reportingFrequency, isExcel),
        inactiveSince: isActive === false ? new Date() : null,
        devAssistantAiTool: normalizeDevAssistantTool(devAssistantAiTool),
      });
      if (userRole === 'admin') {
        await UserPermission.create(
          {
            userId: userId,
            accountId: accountId,
            projectIds: [project.id],
          },
          { transaction: t }
        );
      }
      return project;
    });
    return res.status(201).json({ success: true, data: result });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string; name: string };
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'Project code already exists' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function adminUpdateProject(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id as string);
    const {
      name,
      code,
      accountId,
      dataSourceType,
      jiraBoardId,
      jiraName,
      jiraBaseUrl,
      jiraEmail,
      jiraApiToken,
      jiraLaneConfig,
      azureOrgUrl,
      azureProject,
      azureTeam,
      azurePat,
      azureBoardId,
      isSharedTeam,
      isKanbanProject,
      sprintAssignmentModel,
      piiRedactionEnabled,
      kanbanDoneStatuses,
      kanbanCycleEnabled,
      kanbanCycleDays,
      kanbanCycleStrideDays,
      kanbanCycleAnchorDate,
      kanbanAutoSync,
      estimationType,
      hoursSource,
      hoursFieldName,
      defaultDailyCapacityHours,
      reportingFrequency,
      isActive,
      devAssistantAiTool,
    } = req.body;
    const project = await Project.findByPk(id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    // Determine the resulting source — body wins if supplied, else keep current.
    const effectiveSource = (dataSourceType ?? project.dataSourceType) as
      | 'jira'
      | 'azure_devops'
      | 'excel'
      | 'custom-excel';
    const isExcel = effectiveSource === 'excel';
    // This endpoint is PATCH-style — an omitted field means "keep current",
    // so the cadence check must use the resulting value, not just what was
    // sent, or a partial save (e.g. window-only) could leave a stale stride
    // that no longer satisfies stride >= window.
    const effectiveIsKanban =
      isKanbanProject !== undefined ? !!isKanbanProject : (project as ProjectData).isKanbanProject;
    if (effectiveIsKanban && !isExcel) {
      const effectiveWindow =
        kanbanCycleDays !== undefined ? Number(kanbanCycleDays) || null : (project as ProjectData).kanbanCycleDays;
      const effectiveStride =
        kanbanCycleStrideDays !== undefined
          ? Number(kanbanCycleStrideDays) || null
          : (project as ProjectData).kanbanCycleStrideDays;
      const cadenceCheck = validateKanbanCadence(effectiveWindow, effectiveStride);
      if (!cadenceCheck.valid) {
        return res.status(400).json({ success: false, message: cadenceCheck.error });
      }
    }
    // Manage the active/inactive lifecycle. Only stamp inactiveSince on the
    // active -> inactive transition; clear it on reactivation.
    const wasActive = project.isActive;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activePatch: any = {};
    if (isActive !== undefined) {
      activePatch.isActive = !!isActive;
      if (isActive === false && wasActive !== false) {
        activePatch.inactiveSince = new Date();
      } else if (isActive === true) {
        activePatch.inactiveSince = null;
      }
    }
    await project.update({
      name,
      code,
      accountId,
      ...(dataSourceType ? { dataSourceType } : {}),
      // jiraBoardId is an INTEGER column; the form sends '' for non-Jira (Excel/Azure)
      // projects, which Postgres rejects. Null it out unless this is a Jira project,
      // mirroring the create path.
      jiraBoardId: effectiveSource === 'jira' ? (jiraBoardId === '' || jiraBoardId == null ? null : jiraBoardId) : null,
      jiraName,
      jiraBaseUrl,
      jiraEmail,
      jiraApiToken,
      jiraLaneConfig,
      azureOrgUrl,
      azureProject,
      azureTeam,
      azurePat,
      azureBoardId,
      // Excel projects are sprint-only — force both flags off, ignore client input.
      isSharedTeam: isExcel ? false : isSharedTeam,
      isKanbanProject: isExcel ? false : isKanbanProject,
      // Mirrors the exact isKanbanProject/kanbanCycleEnabled expressions this
      // same call writes below, so deliveryModel can never disagree with what
      // this update actually persists -- see deriveDeliveryModel's docstring.
      // NOTE: kanbanCycleEnabled here is `!!kanbanCycleEnabled`, not PATCH-aware
      // (an omitted field reads as false) -- a pre-existing gap shared by the
      // whole kanban_* block in this handler, same family as the jiraBoardId
      // fix above. Out of scope to fix here; deliveryModel deliberately tracks
      // it as-is rather than diverging from the column it describes.
      deliveryModel: deriveDeliveryModel(isExcel ? false : !!isKanbanProject, isExcel ? false : !!kanbanCycleEnabled),
      // Meaningless for Kanban/Excel -- force 'planned' there regardless of client
      // input. Otherwise PATCH-aware: an omitted field keeps the current value.
      sprintAssignmentModel:
        isExcel || effectiveIsKanban
          ? 'planned'
          : sprintAssignmentModel === undefined
            ? undefined
            : sprintAssignmentModel === 'on_the_go'
              ? 'on_the_go'
              : 'planned',
      piiRedactionEnabled: piiRedactionEnabled === undefined ? undefined : !!piiRedactionEnabled,
      kanbanDoneStatuses: isExcel ? null : kanbanDoneStatuses,
      kanbanCycleEnabled: isExcel ? false : !!kanbanCycleEnabled,
      kanbanCycleDays: isExcel ? null : Number(kanbanCycleDays) || null,
      kanbanCycleStrideDays: isExcel ? null : Number(kanbanCycleStrideDays) || null,
      kanbanCycleAnchorDate: isExcel ? null : kanbanCycleAnchorDate || null,
      kanbanAutoSync: isExcel ? false : !!kanbanAutoSync,
      // Only touch estimation config when the client supplies it (full-form save);
      // a partial update without these keys leaves the existing values intact.
      ...(estimationType !== undefined
        ? {
            estimationType: estimationType === 'hours' ? 'hours' : 'story_points',
            hoursSource: estimationType === 'hours' ? hoursSource || 'time_tracking' : null,
            hoursFieldName: estimationType === 'hours' ? hoursFieldName || null : null,
            defaultDailyCapacityHours: estimationType === 'hours' ? Number(defaultDailyCapacityHours) || null : null,
          }
        : {}),
      ...(reportingFrequency !== undefined
        ? {
            reportingFrequency: normalizeReportingFrequency(reportingFrequency, isExcel),
          }
        : {}),
      ...(devAssistantAiTool !== undefined
        ? { devAssistantAiTool: normalizeDevAssistantTool(devAssistantAiTool) }
        : {}),
      ...activePatch,
    });
    return res.json({ success: true, data: project });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string; name: string };
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'Project code already exists' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function saveProjectMappingTemplate(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id as string);
    const project = await Project.findByPk(id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    // Build and validate the payload BEFORE touching anything — a rejected request
    // must never leave the project without an active mapping.
    /*
     * Resolve every incoming key against the importer's own field list, accepting either the
     * internal key or the human label. The previous approach camel-cased the label with a regex,
     * which quietly invented keys nothing reads: 'Parent / Epic' became 'parent/Epic', so a mapped
     * Parent column was stored under a name the importer never looks up. Unknown keys are dropped
     * rather than persisted.
     */
    const camelCaseObj: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(req.body || {})) {
      const resolved = resolveMappingKey(key);

      if (resolved) {
        camelCaseObj[resolved] = value;
      }
    }

    if (
      (!camelCaseObj.externalId || String(camelCaseObj.externalId).trim() === '') &&
      req.body.dataSource !== 'custom-excel'
    ) {
      return res.status(400).json({ success: false, message: 'External ID column mapping is required' });
    }

    /*
     * A sample file is optional on save: editing an existing mapping reuses the headers already
     * stored, so only a genuinely new sample carries a file. When one is present its headers are
     * read server-side rather than trusting a client-supplied list.
     */
    const file = (req as Request & { file?: Express.Multer.File }).file;
    let sourceHeaders: string[] | null = null;

    if (file) {
      const extension = path.extname(file.originalname ?? '').toLowerCase();

      try {
        sourceHeaders = await extractHeaders(file.buffer, extension === '.csv' ? 'csv' : 'excel');
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: e instanceof Error ? e.message : 'The sample file could not be read',
        });
      }
    }

    /*
     * Every save creates a NEW active mapping and deactivates the previous one.
     *
     * An in-place update variant was briefly used when the client echoed the row id back, but that
     * discards the history: excel_imports records which mapping version parsed it, so "story points
     * imported fine last month and not now" stays explainable only while old versions survive.
     */
    const template = await sequelize.transaction(async t => {
      let previous: TemplateMapping | null = null;

      if (project.templateMappingId) {
        previous = await TemplateMapping.findByPk(project.templateMappingId, { transaction: t });

        if (previous) {
          previous.active = false;
          // Stamped so "which mapping was current when this file was imported" is answerable.
          previous.supersededAt = new Date();
          await previous.save({ transaction: t });
        }
      }
      // Identity and audit columns are server-owned; never take them from the client payload.
      const {
        id: _id,
        projectId: _projectId,
        active: _active,
        createdAt: _c,
        updatedAt: _u,
        ...mapping
      } = camelCaseObj as Record<string, unknown>;

      const created = await TemplateMapping.create(
        {
          ...mapping,
          projectId: id,
          active: true,
          version: (previous?.version ?? 0) + 1,
          // Carry the previous sample forward when this save did not bring a new one, so an edited
          // mapping does not lose the header list that makes it editable.
          sourceHeaders: sourceHeaders ?? previous?.sourceHeaders ?? null,
          originalFilename: file ? file.originalname : (previous?.originalFilename ?? null),
        },
        { transaction: t }
      );

      if (file) {
        // Stored against the new mapping id, so each version keeps the file it was built from.
        const stored = storeMappingSample(id, created.id, file.buffer, file.originalname);
        await created.update(stored, { transaction: t });
      } else if (previous?.storagePath) {
        await created.update(
          {
            storagePath: previous.storagePath,
            fileSize: previous.fileSize,
            checksum: previous.checksum,
            mimeType: previous.mimeType,
          },
          { transaction: t }
        );
      }

      await project.update({ templateMappingId: created.id }, { transaction: t });
      return created;
    });

    return res.status(200).json({ success: true, data: template, message: 'Template saved successfully' });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function getProjectMappingTemplateDetails(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id as string);
    const project = await Project.findByPk(id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const existingTemplate = project.templateMappingId
      ? await TemplateMapping.findByPk(project.templateMappingId)
      : null;

    /*
     * Always respond. Previously the handler simply fell out of the try block when a project had no
     * mapping, so the request hung until the client timed out -- and the form fires this for every
     * project, including Jira ones that never have a mapping.
     */
    if (!existingTemplate) {
      return res.status(200).json({ success: true, data: null, message: 'No mapping configured' });
    }

    /*
     * Return the mapping under the importer's own field keys.
     *
     * These values were previously re-labelled ('externalId' -> 'External ID') on the way out while
     * the save endpoint expected keys, so a saved mapping never repopulated the editor: it came back
     * under names nothing looked up, and every field appeared blank on reopen.
     */
    const plain = existingTemplate.get({ plain: true }) as Record<string, unknown>;

    const mapping = Object.fromEntries(
      MAPPABLE_FIELDS.map(field => [field.key, plain[field.key]]).filter(
        ([, value]) => value !== null && value !== undefined && value !== ''
      )
    );

    return res.status(200).json({
      success: true,
      data: mapping,
      meta: {
        id: existingTemplate.id,
        active: existingTemplate.active,
        version: existingTemplate.version,
        createdAt: existingTemplate.createdAt,
        updatedAt: existingTemplate.updatedAt,
        // The header list is what keeps the mapping editable without re-uploading the sample.
        sourceHeaders: existingTemplate.sourceHeaders ?? [],
        file: existingTemplate.originalFilename
          ? {
              originalFilename: existingTemplate.originalFilename,
              fileSize: existingTemplate.fileSize,
              available: !!existingTemplate.storagePath,
            }
          : null,
      },
      message: 'Template fetched successfully',
    });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function adminDeleteProject(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id as string);
    const project = await Project.findByPk(id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    await project.destroy();
    return res.json({ success: true });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(500).json({ success: false, message: err.message });
  }
}

// Project ↔ TeamMember assignment
export async function adminGetProjectMembers(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.id as string);
    const project = await Project.findByPk(projectId);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const associations = await AccountTeamMember.findAll({
      where: { projectId, accountId: project.accountId },
      include: [{ model: TeamMember }],
    });
    const members = associations.map(a => ({
      ...a.teamMember.toJSON(),
      role: a.role,
      dailyCapacityHours: a.dailyCapacityHours != null ? Number(a.dailyCapacityHours) : null,
      associationId: a.id,
    }));
    return res.json({ success: true, data: members });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function adminAddProjectMember(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.id as string);
    const { teamMemberId, role, dailyCapacityHours } = req.body;
    if (!teamMemberId) return res.status(400).json({ success: false, message: 'teamMemberId required' });

    const project = await Project.findByPk(projectId);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const member = await TeamMember.findByPk(teamMemberId);
    if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

    const [assoc, created] = await AccountTeamMember.findOrCreate({
      where: { accountId: project.accountId, teamMemberId, projectId },
      defaults: {
        role: role || 'Developer',
        dailyCapacityHours: Number(dailyCapacityHours) > 0 ? Number(dailyCapacityHours) : null,
      },
    });

    if (!created) {
      return res.status(409).json({ success: false, message: 'Team member already in project' });
    }
    return res.status(201).json({ success: true, data: assoc });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function adminAddAndUpdateProjectMembers(req: Request, res: Response) {
  try {
    const accountId = parseInt(req.params.accountId as string);
    const teamMemberId = parseInt(req.params.teamMemberId as string);
    if (!accountId) return res.status(400).json({ success: false, message: 'accountId required' });
    if (!teamMemberId) return res.status(400).json({ success: false, message: 'teamMemberId required' });
    const member = await TeamMember.findByPk(teamMemberId);
    if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

    const { data: assignProjects }: { data: AssignProjectType[] } = req.body;
    if (!Array.isArray(assignProjects) || assignProjects.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid payload: 'data' must be a non-empty array." });
    }
    const projectIds = assignProjects.map(({ projectId }) => projectId);
    const foundProjects = await Project.findAll({
      where: {
        accountId: accountId,
        id: { [Op.in]: projectIds },
      },
    });
    if (foundProjects.length !== projectIds.length) {
      return res.status(404).json({ success: false, message: 'Projects not found' });
    }
    const recordsToSync = assignProjects.map(({ id, projectId, role }) => ({
      id: id || undefined,
      accountId,
      teamMemberId,
      projectId,
      role: role || 'Developer',
    }));
    const result = await AccountTeamMember.bulkCreate(recordsToSync, {
      updateOnDuplicate: ['id', 'role'],
      validate: true,
    });
    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function adminRemoveProjectMember(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.id as string);
    const teamMemberId = parseInt(req.params.memberId as string);

    const project = await Project.findByPk(projectId);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const deleted = await AccountTeamMember.destroy({
      where: { projectId, teamMemberId, accountId: project.accountId },
    });
    if (!deleted) return res.status(404).json({ success: false, message: 'Association not found' });
    return res.json({ success: true });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function adminUpdateProjectMemberRole(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.id as string);
    const teamMemberId = parseInt(req.params.memberId as string);
    const { role, dailyCapacityHours } = req.body;
    if (role === undefined && dailyCapacityHours === undefined) {
      return res.status(400).json({ success: false, message: 'role or dailyCapacityHours required' });
    }

    const project = await Project.findByPk(projectId);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = {};
    if (role !== undefined) patch.role = role;
    if (dailyCapacityHours !== undefined) {
      patch.dailyCapacityHours = Number(dailyCapacityHours) > 0 ? Number(dailyCapacityHours) : null;
    }
    const [updated] = await AccountTeamMember.update(patch, {
      where: { projectId, teamMemberId, accountId: project.accountId },
    });
    if (!updated) return res.status(404).json({ success: false, message: 'Assignment not found' });
    return res.json({ success: true });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * List the person-type Jira fields on a project's board, with how often each is
 * actually populated on the current sprint.
 *
 * The percentage is the point: field NAMES do not tell you which one a team uses.
 * On Thrive's Delta board "Developer" is filled on 70% of tickets and is the real
 * ownership record, while `assignee` is a work-queue pointer that moved 150 times
 * in one sprint. Showing coverage lets an admin choose on evidence instead of
 * guessing from the name.
 *
 * Fields that describe who RAISED or DESIGNED the work rather than who delivers it
 * are flagged so the UI can de-emphasise them.
 */
const NON_DELIVERY_FIELDS = new Set([
  'reporter',
  'creator',
  'product manager',
  'ux designer',
  'designer',
  'business owner',
  'request participants',
  'approvers',
]);

export async function adminGetProjectPersonFields(req: Request, res: Response) {
  try {
    const project = await Project.findByPk(Number(req.params.id));
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!project.jiraBoardId) {
      return res.status(400).json({ success: false, message: 'Project has no Jira board configured' });
    }

    const jira = JiraService.forProject(project);
    const all = await jira.getFields();
    const personFields = (all ?? []).filter(
      f => f?.schema && (f.schema.type === 'user' || (f.schema.type === 'array' && f.schema.items === 'user'))
    );

    // Sample the active sprint to measure how often each field is filled. This MUST
    // bypass the normal field allowlist: that allowlist only requests fields the project
    // already declares, so an undeclared field would read 0% — reporting "Developer 0%"
    // for the very field the admin is trying to discover. Best effort: a board with no
    // active sprint still returns the field list, just without coverage.
    let counts: Record<string, number> = {};
    let sampleSize = 0;
    try {
      const sprint = await jira.getActiveSprint(project.jiraBoardId);
      if (sprint) {
        const sampled = await jira.sampleFieldPresence(
          sprint.id,
          personFields.map(f => f.id)
        );
        counts = sampled.counts;
        sampleSize = sampled.sampleSize;
      }
    } catch (e) {
      const err = e as Error & { response?: { status?: number }; status?: number; message?: string };
      logger.warn(`Could not sample sprint coverage for project ${project.code}: ${err?.message}`, 'AdminController');
    }

    const fields = personFields
      .map(f => ({
        id: f.id,
        name: f.name,
        filled: counts[f.id] ?? 0,
        coveragePct: sampleSize > 0 ? Math.round(((counts[f.id] ?? 0) / sampleSize) * 100) : null,
        likelyDelivery: !NON_DELIVERY_FIELDS.has(String(f.name).toLowerCase()),
      }))
      .sort((a, b) => b.filled - a.filled || a.name.localeCompare(b.name));

    return res.json({ success: true, sampleSize, fields });
  } catch (e) {
    const err = e as Error & { response?: { status?: number }; status?: number; message?: string };
    logger.error('adminGetProjectPersonFields failed', err, 'AdminController');
    return res.status(400).json({
      success: false,
      message: `Could not read Jira fields: ${err.message}`,
    });
  }
}
