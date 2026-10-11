import { Request, Response } from 'express';
import { Project } from '../../../models/Project';
import { UserPermission } from '../../../models/UserPermission';

interface AuthUser {
  id?: number;
  role?: string;
  roleName?: string;
}

interface AuthRequest extends Request {
  user?: AuthUser;
}

export class ProjectController {
  async getAllProjects(req: AuthRequest, res: Response) {
    try {
      const { accountId } = req.query;
      const userId = req.user?.id;
      const userRole = req.user?.role;
      // Default hides inactive projects -- correct for "pick something to work
      // with" pickers (Board View, Presentation, new Risk/Retro). A caller that's
      // managing/editing an EXISTING association (Admin's user-permissions grid,
      // nav/feature-visibility checks, Risk reassignment) must pass
      // includeInactive=true, or it'll silently lose sight of -- and, for the
      // permissions grid, silently drop -- an already-granted inactive project.
      const includeInactive = req.query.includeInactive === 'true';

      // SUPERUSER sees all projects (all, or active-only per includeInactive).
      // The separate /api/admin/projects endpoint (adminController.adminGetProjects)
      // is unaffected either way and always shows everything.
      if (userRole === 'SUPERUSER') {
        const whereClause: { accountId?: number; isActive?: boolean } = accountId ? { accountId: Number(accountId) } : {};
        if (!includeInactive) whereClause.isActive = true;
        const projects = await Project.findAll({
          where: whereClause,
          attributes: [
            'id',
            'name',
            'code',
            'jiraBoardId',
            'accountId',
            'programId',
            'workMode',
            'isKanbanProject',
            'kanbanDoneStatuses',
            'deliveryModel',
            'tracksCommitment',
            'sprintAssignmentModel',
            'kanbanCycleEnabled',
            'kanbanCycleDays',
            'kanbanCycleStrideDays',
            'kanbanCycleAnchorDate',
            'piiRedactionEnabled',
            'isSharedTeam',
            'dataSourceType',
            'estimationType',
            'reportingFrequency',
            'devAssistantAiTool',
            'hoursSource',
            'hoursFieldName',
            'defaultDailyCapacityHours',
            'isActive',
            'inactiveSince',
          ],
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

      // Regular users - filter by permissions
      const permissions = await UserPermission.findAll({ where: { userId } });

      // Get accessible project IDs
      const accessibleProjectIds = new Set<number>();
      const accessibleAccountIds = new Set<number>(); // Accounts where the user has SOME access

      // Track which accounts the user has program-scoped access to, and which programs.
      // Program-scoped rows (programId != null) confer access only to projects that belong
      // to that program — NOT account-wide full access, even though their projectIds is empty.
      const accessibleProgramIds = new Set<number>();

      permissions.forEach(p => {
        if (p.accountId !== null) {
          if (p.programId) {
            accessibleProgramIds.add(p.programId);
            accessibleAccountIds.add(p.accountId);
            return; // do not contribute to the account-wide full-access path
          }
          accessibleAccountIds.add(p.accountId);
          if (p.projectIds && p.projectIds.length > 0) {
            p.projectIds.forEach(id => accessibleProjectIds.add(id));
          }
          // If projectIds is null or empty on a non-program-scoped row, the row signifies
          // FULL ACCESS to the account's projects — handled in the filter below.
        }
      });

      // Build where clause -- see includeInactive comment above.
      const whereClause: { accountId?: number; isActive?: boolean } = {};
      if (!includeInactive) whereClause.isActive = true;

      if (accountId) {
        // If filtering by account, check if user has access to AT LEAST ONE project in this account
        const accId = Number(accountId);

        // If they don't even have an entry for this account, or they have an entry but no projects
        if (!accessibleAccountIds.has(accId)) {
          return res.json({ success: true, data: [] });
        }

        whereClause.accountId = accId;
      }

      // Filter by accessible projects/accounts
      const projects = await Project.findAll({
        where: whereClause,
        attributes: [
          'id',
          'name',
          'code',
          'jiraBoardId',
          'accountId',
          'programId',
          'workMode',
          'isKanbanProject',
          'kanbanDoneStatuses',
          'deliveryModel',
          'tracksCommitment',
          'sprintAssignmentModel',
          'kanbanCycleEnabled',
          'kanbanCycleDays',
          'kanbanCycleStrideDays',
          'kanbanCycleAnchorDate',
          'piiRedactionEnabled',
          'isSharedTeam',
          'dataSourceType',
          'estimationType',
          'reportingFrequency',
          'devAssistantAiTool',
          'hoursSource',
          'hoursFieldName',
          'defaultDailyCapacityHours',
          'isActive',
          'inactiveSince',
        ],
        include: [
          {
            association: 'account',
            attributes: ['id', 'name'],
          },
        ],
        order: [['name', 'ASC']],
      });

      // Filter results based on permissions
      const filteredProjects = projects.filter((project: Project) => {
        // Pin to the account-scoped rows so a program-owner row's empty projectIds
        // never gets read as "full account access" (the post-Phase-2 regression).
        // Every matching row, not `.find()`'s first one: with no unique constraint on
        // (userId, accountId, programId), a stale duplicate row can sit next to the
        // current one, and `.find()`'s unordered pick could land on an empty-projectIds
        // row that shouldn't exist any more, over-granting full account access.
        const accountScopedPerms = permissions.filter(p => p.accountId === project.accountId && !p.programId);

        // Account-scoped rows grant full access only if EVERY one agrees (fail
        // closed) — a single scoped row narrows access even if a stale
        // empty-projectIds row is still sitting next to it. Otherwise fall back to
        // the union of projectIds across all rows, already aggregated above.
        if (accountScopedPerms.length > 0) {
          if (accountScopedPerms.every(p => !p.projectIds || p.projectIds.length === 0)) return true;
          if (accessibleProjectIds.has(project.id)) return true;
        }

        // Program-scoped access: project must belong to a program the user owns.
        if (project.programId && accessibleProgramIds.has(project.programId)) {
          return true;
        }

        return false;
      });

      return res.json({
        success: true,
        data: filteredProjects,
      });
    } catch (error) {
      const errorResponse = error as { response?: { data?: { error?: string } }; message?: string };
      console.error('Error fetching projects:', errorResponse);
      return res.status(500).json({
        success: false,
        message: 'An error occurred',
      });
    }
  }
}

export const projectController = new ProjectController();
