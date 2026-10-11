import { Request, Response } from 'express';
import { Op, Sequelize, WhereOptions } from 'sequelize';
import { DailyBoardSnapshot } from '../../../models/DailyBoardSnapshot';
import { ProjectActionItem } from '../../../models/ProjectActionItem';
import { AccountActionItem } from '../../../models/AccountActionItem';
import { Risk } from '../../../models/Risk';
import { Project } from '../../../models/Project';
import { Account } from '../../../models/Account';
import { User } from '../../../models/User';
import { UserPermission } from '../../../models/UserPermission';
import { UserRole } from '../../../models/UserRole';
import { Role } from '../../../models/Role';
import { getAccessibleProjectIds } from '../../../common/projectAccess';

interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    role?: string;
    roleName: string;
  };
}

/** Fetch top 5 recent open action items, optionally scoped to project IDs and excluding superuser/admin-created items. */
async function fetchRecentActionItems(
  projectIds: number[],
  excludeAdminCreated: boolean
): Promise<ProjectActionItem[]> {
  const where: WhereOptions = {
    status: { [Op.in]: ['Open', 'In-Progress'] },
  };
  if (projectIds.length > 0) {
    where.projectId = { [Op.in]: projectIds };
  }

  const items = await ProjectActionItem.findAll({
    where,
    include: [
      { model: Project, attributes: ['id', 'name'] },
      { model: User, as: 'createdBy', attributes: ['id', 'firstName', 'lastName'] },
    ],
    order: [['createdAt', 'DESC']],
    limit: excludeAdminCreated ? 20 : 5, // fetch extra to filter
  });

  if (!excludeAdminCreated) return items.map(i => i.toJSON()).slice(0, 5);

  // Filter out items created by superuser/admin
  const filtered: ProjectActionItem[] = [];
  for (const item of items) {
    if (filtered.length >= 5) break;
    const creatorId = item.createdById;
    if (!creatorId) {
      filtered.push(item.toJSON());
      continue;
    }
    const creatorUser = await User.findByPk(creatorId);
    if (!creatorUser) {
      filtered.push(item.toJSON());
      continue;
    }
    if (creatorUser.role === 'SUPERUSER') continue;
    const userRole = await UserRole.findOne({ where: { userId: creatorId }, include: [{ model: Role, as: 'role' }] });
    const rn = userRole?.role?.name ?? '';
    if (rn === 'superuser' || rn === 'admin') continue;
    filtered.push(item.toJSON());
  }
  return filtered;
}

class DashboardController {
  async getOverview(req: AuthenticatedRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'User not authenticated' });

      const roleName: string = user?.roleName ?? '';
      const legacyRole: string = user?.role ?? '';

      const acctDetails: Account[] = [];
      const projectIds: number[] = [];

      // ── Superuser / Admin — account tile view ─────────────────────────
      if (legacyRole === 'SUPERUSER' || roleName === 'admin') {
        if (legacyRole === 'SUPERUSER') {
          const accts = await Account.findAll({ order: [['name', 'ASC']] });
          acctDetails.push(...accts);
        } else {
          const adminAcctPerms = await UserPermission.findAll({
            where: { userId: user.id },
            raw: true,
          });

          const accIds = Array.from(new Set(adminAcctPerms.flatMap(p => p.accountId || [])));

          const adminAcct = await Account.findAll({
            where: { id: { [Op.in]: accIds } },
          });

          acctDetails.push(...adminAcct);

          const ids = new Set<number>();
          const accountIdsForFullAccess: number[] = [];
          const programIds: number[] = [];

          for (const p of adminAcctPerms) {
            if (p.accountId == null) continue;
            if (p.programId) {
              programIds.push(p.programId);
              continue;
            }
            if (p.projectIds && p.projectIds.length > 0) {
              for (const id of p.projectIds) ids.add(id);
            } else {
              accountIdsForFullAccess.push(p.accountId);
            }
          }

          if (accountIdsForFullAccess.length > 0 || programIds.length > 0) {
            const orConditions: WhereOptions[] = [];
            if (accountIdsForFullAccess.length > 0) {
              orConditions.push({ accountId: { [Op.in]: accountIdsForFullAccess } });
            }
            if (programIds.length > 0) {
              orConditions.push({ programId: { [Op.in]: programIds } });
            }
            const projects = await Project.findAll({
              where: {
                [Op.or]: orConditions,
              },
              attributes: ['id'],
            });
            for (const p of projects) ids.add(p.id);
          }
          projectIds.push(...ids);
        }

        const targetAccountIds = acctDetails.map(acct => acct.id);
        const allProject = await Project.findAll({
          where: {
            accountId: { [Op.in]: targetAccountIds },
            ...(legacyRole === 'SUPERUSER' ? {} : { id: { [Op.in]: projectIds } }),
          },
          raw: true,
        });

        const result = await Promise.all(
          acctDetails.map(async acct => {
            const accountProjects = allProject.filter(p => p.accountId === acct.id);
            const projIds = accountProjects.map(p => p.id);
            const openAICount =
              projIds.length > 0
                ? await ProjectActionItem.count({
                    where: { projectId: { [Op.in]: projIds }, status: { [Op.in]: ['Open', 'In-Progress'] } },
                  })
                : 0;

            const accountAICount = await AccountActionItem.count({
              where: { accountId: acct.id, status: { [Op.in]: ['Open', 'In-Progress'] } },
            });

            const activeRiskCount =
              projIds.length > 0
                ? await Risk.count({ where: { projectId: { [Op.in]: projIds }, status: { [Op.ne]: 'DONE' } } })
                : 0;

            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const longPendingCount =
              projIds.length > 0
                ? await ProjectActionItem.count({
                    where: {
                      projectId: { [Op.in]: projIds },
                      status: 'Open',
                      createdAt: { [Op.lt]: thirtyDaysAgo },
                    },
                  })
                : 0;

            return {
              id: acct.id,
              name: acct.name,
              projectCount: accountProjects.length,
              openAICount: openAICount + accountAICount,
              activeRiskCount,
              longPendingCount,
              projects: accountProjects.map(p => ({ id: p.id, name: p.name })),
            };
          })
        );

        // Top 5 active risks — CRITICAL first, then creation date desc
        const topRisks = await Risk.findAll({
          where: { status: { [Op.in]: ['NEW', 'WORK_IN_PROGRESS'] } },
          include: [{ model: Project, attributes: ['id', 'name'] }],
          order: [
            [
              Sequelize.literal(
                `CASE priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END`
              ),
              'ASC',
            ],
            ['createdAt', 'DESC'],
          ],
          limit: 5,
        });
        const totalActiveRisks = await Risk.count({
          where: { status: { [Op.in]: ['NEW', 'WORK_IN_PROGRESS'] } },
        });

        // Long-pending AIs across all projects
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const longPendingAIs = await ProjectActionItem.findAll({
          where: {
            ...(legacyRole === 'SUPERUSER' ? {} : { projectId: { [Op.in]: projectIds } }),
            status: 'Open',
            createdAt: { [Op.lt]: thirtyDaysAgo },
          },
          include: [{ model: Project, attributes: ['id', 'name'] }],
          order: [['createdAt', 'ASC']],
          limit: 20,
        });

        // Project health list for the health overview table
        const allProjects = await Project.findAll({
          where: legacyRole === 'SUPERUSER' ? {} : { id: { [Op.in]: projectIds } },
          include: [{ model: Account, attributes: ['id', 'name'] }],
          order: [['name', 'ASC']],
        });
        const projectHealthList = await Promise.all(
          allProjects.map(async proj => {
            const snap = await DailyBoardSnapshot.findOne({
              where: { projectId: proj.id },
              order: [['date', 'DESC']],
              attributes: [
                'overallHealth',
                'insightsHealth',
                'insightsHealthReason',
                'healthRationale',
                'sprintBurndown',
              ],
            });
            const openAICount = await ProjectActionItem.count({
              where: { projectId: proj.id, status: { [Op.ne]: 'Closed' } },
            });
            const activeRiskCount = await Risk.count({
              where: { projectId: proj.id, status: { [Op.ne]: 'DONE' } },
            });
            const burndown = snap ? snap.sprintBurndown : null;
            return {
              id: proj.id,
              name: proj.name,
              accountName: proj.account?.name ?? null,
              health: snap?.overallHealth ?? null,
              insightsHealth: snap?.insightsHealth ?? null,
              sprintStatus: burndown?.onTrackStatus ?? null,
              activeRiskCount,
              openAICount,
              latestSnapshot: snap
                ? {
                    healthRationale: snap.healthRationale ?? null,
                    insightsHealthReason: snap.insightsHealthReason ?? null,
                  }
                : null,
            };
          })
        );

        // Top 5 recent open action items (superuser sees all)
        const recentActionItems = await fetchRecentActionItems(legacyRole === 'SUPERUSER' ? [] : projectIds, false);

        return res.json({
          type: 'account',
          accounts: result,
          topRisks: topRisks.map(r => r.toJSON()),
          totalActiveRisks,
          longPendingAIs: longPendingAIs.map(i => i.toJSON()),
          projectHealthList,
          recentActionItems,
        });
      }

      // ── Manager — project tile view ────────────────────────────────────
      if (roleName === 'manager') {
        const permissions = await getAccessibleProjectIds(user.id);

        const projectIds = Array.from(permissions);
        const projects = await Project.findAll({
          where: { id: { [Op.in]: projectIds } },
          include: [{ model: Account, attributes: ['id', 'name'] }],
          order: [['name', 'ASC']],
        });

        const now = new Date();
        const projectData = await Promise.all(
          projects.map(async proj => {
            const latestSnapshot = await DailyBoardSnapshot.findOne({
              where: { projectId: proj.id },
              order: [['date', 'DESC']],
              attributes: [
                'id',
                'date',
                'overallHealth',
                'executiveSummary',
                'sprintBurndown',
                'managerInsights',
                'insightsHealth',
                'healthRationale',
                'insightsHealthReason',
              ],
            });

            const openAICount = await ProjectActionItem.count({
              where: { projectId: proj.id, status: { [Op.in]: ['Open', 'In-Progress'] } },
            });

            const overdueAICount = await ProjectActionItem.count({
              where: {
                projectId: proj.id,
                status: { [Op.in]: ['Open', 'In-Progress'] },
                dueDate: { [Op.lt]: now },
              },
            });

            const activeRiskCount = await Risk.count({
              where: { projectId: proj.id, status: { [Op.ne]: 'DONE' } },
            });

            const snap = latestSnapshot ? latestSnapshot.toJSON() : null;
            const execSummary: string = snap?.executiveSummary ?? '';
            const burndown = snap?.sprintBurndown ?? null;

            return {
              id: proj.id,
              name: proj.name,
              code: proj.code,
              account: proj.account,
              workMode: proj.isKanbanProject ? 'kanban' : 'sprint',
              openAICount,
              overdueAICount,
              activeRiskCount,
              sprintStatus: burndown?.onTrackStatus ?? null,
              latestSnapshot: snap
                ? {
                    id: snap.id,
                    date: snap.date,
                    overallHealth: snap.overallHealth,
                    insightsHealth: snap.insightsHealth,
                    execSummarySnippet: execSummary.slice(0, 200),
                    sprintBurndown: snap.sprintBurndown,
                    managerInsights: snap.managerInsights,
                  }
                : null,
            };
          })
        );

        // Top 6 urgent action items across all accessible projects
        const topActionItems =
          projectIds.length > 0
            ? await ProjectActionItem.findAll({
                where: { projectId: { [Op.in]: projectIds }, status: { [Op.ne]: 'Closed' } },
                order: [['dueDate', 'ASC']],
                limit: 6,
                include: [{ model: Project, attributes: ['id', 'name'] }],
              })
            : [];

        // Top 5 recent action items (exclude superuser/admin-created)
        const recentActionItems = await fetchRecentActionItems(projectIds, true);

        return res.json({
          type: 'project',
          projects: projectData,
          topActionItems: topActionItems.map(i => i.toJSON()),
          recentActionItems,
        });
      }

      // ── Lead / Member — project tile list (same format as manager) ────
      const permissions = await getAccessibleProjectIds(user.id);

      const leadProjectIds = Array.from(permissions);
      if (leadProjectIds.length === 0) {
        return res.json({ type: 'project', projects: [] });
      }

      const leadProjects = await Project.findAll({
        where: { id: { [Op.in]: leadProjectIds } },
        include: [{ model: Account, attributes: ['id', 'name'] }],
        order: [['name', 'ASC']],
      });

      const now2 = new Date();
      const leadProjectData = await Promise.all(
        leadProjects.map(async proj => {
          const latestSnapshot = await DailyBoardSnapshot.findOne({
            where: { projectId: proj.id },
            order: [['date', 'DESC']],
            attributes: [
              'id',
              'date',
              'overallHealth',
              'executiveSummary',
              'sprintBurndown',
              'managerInsights',
              'insightsHealth',
              'healthRationale',
              'insightsHealthReason',
            ],
          });

          const openAICount = await ProjectActionItem.count({
            where: { projectId: proj.id, status: { [Op.in]: ['Open', 'In-Progress'] } },
          });
          const overdueAICount = await ProjectActionItem.count({
            where: { projectId: proj.id, status: { [Op.in]: ['Open', 'In-Progress'] }, dueDate: { [Op.lt]: now2 } },
          });
          const activeRiskCount = await Risk.count({
            where: { projectId: proj.id, status: { [Op.ne]: 'DONE' } },
          });

          const snap = latestSnapshot ? latestSnapshot.toJSON() : null;
          const execSummary: string = snap?.executiveSummary ?? '';
          const burndown = snap?.sprintBurndown ?? null;

          return {
            id: proj.id,
            name: proj.name,
            code: proj.code,
            account: proj.account,
            workMode: proj.isKanbanProject ? 'kanban' : 'sprint',
            openAICount,
            overdueAICount,
            activeRiskCount,
            sprintStatus: burndown?.onTrackStatus ?? null,
            latestSnapshot: snap
              ? {
                  id: snap.id,
                  date: snap.date,
                  overallHealth: snap.overallHealth,
                  insightsHealth: snap.insightsHealth,
                  execSummarySnippet: execSummary.slice(0, 200),
                  sprintBurndown: snap.sprintBurndown,
                  managerInsights: snap.managerInsights,
                  healthRationale: snap.healthRationale ?? null,
                  insightsHealthReason: snap.insightsHealthReason ?? null,
                }
              : null,
          };
        })
      );

      // Top 5 recent action items (exclude superuser/admin-created)
      const recentActionItems = await fetchRecentActionItems(leadProjectIds, true);

      return res.json({ type: 'project', projects: leadProjectData, recentActionItems });
    } catch (err) {
      console.error('dashboard overview error:', err);
      res.status(500).json({ error: 'Failed to load dashboard' });
    }
  }

  async getProjectDetail(req: AuthenticatedRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'User not authenticated' });

      const projectId = parseInt(req.params.projectId as string);

      // Verify access
      const permissions = await UserPermission.findAll({ where: { userId: user.id } });
      const roleName: string = user?.roleName ?? '';
      const legacyRole: string = user?.role ?? '';
      const isSuperuser = legacyRole === 'SUPERUSER' || roleName === 'admin';

      if (!isSuperuser) {
        let hasAccess = false;
        for (const perm of permissions) {
          if (!perm.accountId) continue;
          if (perm.programId) {
            // Program-scoped row: project must belong to the same program.
            const proj = await Project.findOne({
              where: { id: projectId, accountId: perm.accountId, programId: perm.programId },
            });
            if (proj) {
              hasAccess = true;
              break;
            }
            continue;
          }
          if (!perm.projectIds || perm.projectIds.length === 0) {
            const proj = await Project.findOne({ where: { id: projectId, accountId: perm.accountId } });
            if (proj) {
              hasAccess = true;
              break;
            }
          } else if (perm.projectIds.includes(projectId)) {
            hasAccess = true;
            break;
          }
        }
        if (!hasAccess) return res.status(403).json({ error: 'Access denied' });
      }

      const project = await Project.findByPk(projectId, {
        include: [{ model: Account, attributes: ['id', 'name'] }],
      });
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const latestSnapshot = await DailyBoardSnapshot.findOne({
        where: { projectId },
        order: [['date', 'DESC']],
        attributes: [
          'id',
          'date',
          'overallHealth',
          'executiveSummary',
          'executivePlan',
          'sprintBurndown',
          'blockedTickets',
          'managerInsights',
          'insightsHealth',
          'healthRationale',
          'insightsHealthReason',
          'insightsAuthorId',
          'insightsAuthorName',
          'teamNotes',
        ],
      });

      const openAIs = await ProjectActionItem.findAll({
        where: { projectId, status: { [Op.in]: ['Open', 'In-Progress'] } },
        order: [['createdAt', 'DESC']],
        limit: 10,
      });

      const now = new Date();
      const overdueAICount = await ProjectActionItem.count({
        where: { projectId, status: { [Op.in]: ['Open', 'In-Progress'] }, dueDate: { [Op.lt]: now } },
      });

      const activeRisks = await Risk.findAll({
        where: { projectId, status: { [Op.ne]: 'DONE' } },
        order: [['createdAt', 'DESC']],
        limit: 5,
      });

      const snap = latestSnapshot ? latestSnapshot.toJSON() : null;
      const execSummary: string = snap?.executiveSummary ?? '';

      return res.json({
        project: {
          id: project.id,
          name: project.name,
          code: project.code,
          account: project.account,
          workMode: project.isKanbanProject ? 'kanban' : 'sprint',
          openAIs: openAIs.map(i => i.toJSON()),
          overdueAICount,
          activeRisks: activeRisks.map(r => r.toJSON()),
          latestSnapshot: snap
            ? {
                id: snap.id,
                date: snap.date,
                overallHealth: snap.overallHealth,
                insightsHealth: snap.insightsHealth,
                healthRationale: snap.healthRationale ?? null,
                insightsHealthReason: snap.insightsHealthReason ?? null,
                execSummarySnippet: execSummary.slice(0, 400),
                sprintBurndown: snap.sprintBurndown,
                blockedTickets: snap.blockedTickets ?? [],
                executivePlan: snap.executivePlan ?? '',
                managerInsights: snap.managerInsights,
                insightsAuthorId: snap.insightsAuthorId ?? null,
                insightsAuthorName: snap.insightsAuthorName ?? null,
                teamNotes: snap.teamNotes ?? [],
              }
            : null,
        },
      });
    } catch (err) {
      console.error('dashboard project detail error:', err);
      res.status(500).json({ error: 'Failed to load project detail' });
    }
  }
}

export const dashboardController = new DashboardController();
