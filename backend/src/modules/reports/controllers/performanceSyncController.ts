/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { performanceSyncService } from '../services/performanceSyncService';
import { getMergedTrendsData, buildTrendsHtml, buildTrendsWorkbook } from '../services/trendsReportExportService';
import { perfSyncQueue } from '../queues/perfSyncQueue';
import { PerfSprintSync } from '../../../models/PerfSprintSync';
import { ProjectSprint } from '../../../models/ProjectSprint';
import { cycleByIndex, cycleLabel } from '../services/kanbanCycleService';
import { Project } from '../../../models/Project';
import { scopeToAccessibleProjects } from '../../../common/projectAccess';

class PerformanceSyncController {
  /** GET /report/project/:projectId/perf/syncs */
  async getSyncHistory(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const syncs = await performanceSyncService.getSyncHistory(projectId);
      res.json({ success: true, data: syncs });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** POST /report/project/:projectId/perf/sync/sprint */
  async triggerSprintSync(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const { jiraSprintId } = req.body;
      const userId = (req as any).user?.id;

      if (!jiraSprintId) {
        res.status(400).json({ error: 'jiraSprintId is required' });
        return;
      }

      const activeSync = await PerfSprintSync.findOne({
        where: { projectId, syncStatus: { [Op.in]: ['pending', 'running'] } },
      });
      if (activeSync) {
        res
          .status(409)
          .json({ error: 'A sync is already in progress for this project. Please wait for it to complete.' });
        return;
      }

      await perfSyncQueue.add('sync-sprint-performance', {
        projectId,
        jiraSprintId: parseInt(String(jiraSprintId)),
        triggeredByUserId: userId,
      });

      res.json({ success: true, message: 'Sprint sync queued' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** POST /report/project/:projectId/perf/sync/kanban */
  async triggerKanbanSync(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const { fromDate, toDate, label } = req.body;
      const userId = (req as any).user?.id;

      if (!fromDate || !toDate) {
        res.status(400).json({ error: 'fromDate and toDate are required' });
        return;
      }

      const activeSync = await PerfSprintSync.findOne({
        where: { projectId, syncStatus: { [Op.in]: ['pending', 'running'] } },
      });
      if (activeSync) {
        res
          .status(409)
          .json({ error: 'A sync is already in progress for this project. Please wait for it to complete.' });
        return;
      }

      await perfSyncQueue.add('sync-sprint-performance', {
        projectId,
        fromDate,
        toDate,
        label: label ?? `${fromDate} to ${toDate}`,
        triggeredByUserId: userId,
      });

      res.json({ success: true, message: 'Kanban period sync queued' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** GET /report/project/:projectId/perf/kanban/cycles */
  async listKanbanCycles(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 24;
      const cycles = await performanceSyncService.getKanbanCyclesForProject(projectId, limit);
      res.json({ success: true, data: cycles });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** POST /report/project/:projectId/perf/sync/kanban-cycle  body: { cycleIndex } */
  async triggerKanbanCycleSync(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const { cycleIndex } = req.body;
      const userId = (req as any).user?.id;

      if (cycleIndex === undefined || cycleIndex === null) {
        res.status(400).json({ error: 'cycleIndex is required' });
        return;
      }

      const cycle = await performanceSyncService.resolveKanbanCycle(projectId, parseInt(String(cycleIndex)));
      if (!cycle) {
        res.status(400).json({ error: 'Could not resolve cycle. Is cadence configured for this project?' });
        return;
      }

      // One active sync per project.
      const activeSync = await PerfSprintSync.findOne({
        where: { projectId, syncStatus: { [Op.in]: ['pending', 'running'] } },
      });
      if (activeSync) {
        res
          .status(409)
          .json({ error: 'A sync is already in progress for this project. Please wait for it to complete.' });
        return;
      }

      // Dedup: this exact cycle window is already synced.
      const existing = await PerfSprintSync.findOne({
        where: {
          projectId,
          syncType: 'kanban',
          startDate: cycle.startDate,
          endDate: cycle.endDate,
          syncStatus: { [Op.in]: ['pending', 'running', 'done'] },
        },
      });
      if (existing) {
        res.status(409).json({ error: 'This cycle is already synced. Delete the existing sync to re-run it.' });
        return;
      }

      await perfSyncQueue.add(
        'sync-sprint-performance',
        {
          projectId,
          fromDate: cycle.startDate,
          toDate: cycle.endDate,
          label: cycle.label,
          triggeredByUserId: userId,
        },
        { jobId: 'kanban-cycle-' + projectId + '-' + cycle.startDate }
      );

      res.json({ success: true, message: 'Kanban cycle sync queued' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** PUT /report/project/:projectId/perf/kanban/cycles/:cycleIndex/override  body: { startDate, endDate } */
  async overrideKanbanCycle(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const cycleIndex = parseInt(req.params.cycleIndex as string);
      const { startDate, endDate } = req.body;

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate and endDate are required' });
        return;
      }

      const project = await Project.findByPk(projectId);
      if (!project || !project.kanbanCycleDays || !project.kanbanCycleAnchorDate) {
        res.status(400).json({ error: 'Cadence is not configured for this project' });
        return;
      }
      const baseCycle = cycleByIndex(
        project.kanbanCycleAnchorDate, project.kanbanCycleDays, cycleIndex, project.kanbanCycleStrideDays,
      );
      if (!baseCycle) {
        res.status(400).json({ error: 'Invalid cycle index' });
        return;
      }

      // Key the override row on the deterministic default label for this index.
      const existing = await ProjectSprint.findOne({
        where: { projectId, source: 'kanban_cycle', name: baseCycle.label },
      });
      if (existing) {
        await existing.update({ startDate, endDate });
      } else {
        await ProjectSprint.create({
          projectId,
          name: baseCycle.label,
          startDate,
          endDate,
          source: 'kanban_cycle',
        } as any);
      }

      res.json({ success: true, data: { startDate, endDate, label: cycleLabel(startDate, endDate) } });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** DELETE /report/project/:projectId/perf/kanban/cycles/:cycleIndex/override */
  async clearKanbanCycleOverride(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const cycleIndex = parseInt(req.params.cycleIndex as string);

      const project = await Project.findByPk(projectId);
      if (!project || !project.kanbanCycleDays || !project.kanbanCycleAnchorDate) {
        res.status(400).json({ error: 'Cadence is not configured for this project' });
        return;
      }
      const baseCycle = cycleByIndex(
        project.kanbanCycleAnchorDate, project.kanbanCycleDays, cycleIndex, project.kanbanCycleStrideDays,
      );
      if (!baseCycle) {
        res.status(400).json({ error: 'Invalid cycle index' });
        return;
      }

      await ProjectSprint.destroy({
        where: { projectId, source: 'kanban_cycle', name: baseCycle.label },
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** GET /report/project/:projectId/perf/kanban/live-span — live scorecard for the in-progress cycle */
  async getLiveKanbanSpan(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const result = await performanceSyncService.generateLiveKanbanSpan(projectId);
      res.json({ success: true, data: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** GET /report/project/:projectId/perf/sync/:syncId/scorecard */
  async getScorecard(req: Request, res: Response): Promise<void> {
    try {
      const syncId = parseInt(req.params.syncId as string);
      const result = await performanceSyncService.getScorecard(syncId);
      res.json({ success: true, data: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** GET /report/project/:projectId/perf/sync/:syncId/tickets */
  async getTicketFacts(req: Request, res: Response): Promise<void> {
    try {
      const syncId = parseInt(req.params.syncId as string);
      const jiraLoginId = req.query.jiraLoginId as string | undefined;
      const facts = await performanceSyncService.getTicketFacts(syncId, jiraLoginId);
      res.json({ success: true, data: facts });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** PATCH /report/project/:projectId/perf/sync/:syncId/member/override */
  async saveOverride(req: Request, res: Response): Promise<void> {
    try {
      const syncId = parseInt(req.params.syncId as string);
      const { jiraLoginId, metrics, reason } = req.body;
      const userId = (req as any).user?.id;

      if (!jiraLoginId || !metrics || !reason) {
        res.status(400).json({ error: 'jiraLoginId, metrics, and reason are required' });
        return;
      }

      const score = await performanceSyncService.saveOverride({ syncId, jiraLoginId, metrics, reason, userId });
      res.json({ success: true, data: score });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** DELETE /report/project/:projectId/perf/sync/:syncId/member/override */
  async clearOverride(req: Request, res: Response): Promise<void> {
    try {
      const syncId = parseInt(req.params.syncId as string);
      const { jiraLoginId } = req.body;

      if (!jiraLoginId) {
        res.status(400).json({ error: 'jiraLoginId is required' });
        return;
      }

      await performanceSyncService.clearOverride(syncId, jiraLoginId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** POST /report/project/:projectId/perf/sync/:syncId/recompute */
  async recompute(req: Request, res: Response): Promise<void> {
    try {
      const syncId = parseInt(req.params.syncId as string);
      await performanceSyncService.recomputeScores(syncId);
      res.json({ success: true, message: 'Scores recomputed' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** POST /report/project/:projectId/perf/sync/:syncId/retry
   *  Re-triggers a full Jira sync for a failed (error) sync record.
   */
  async retry(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const syncId = parseInt(req.params.syncId as string);
      const userId = (req as any).user?.id;

      const sync = await PerfSprintSync.findOne({ where: { id: syncId, projectId } });
      if (!sync) {
        res.status(404).json({ error: 'Sync record not found' });
        return;
      }
      if (sync.syncStatus !== 'error') {
        res.status(400).json({ error: 'Only error syncs can be retried' });
        return;
      }

      if (sync.syncType === 'sprint' && sync.jiraSprintId) {
        await perfSyncQueue.add('sync-sprint-performance', {
          projectId,
          jiraSprintId: sync.jiraSprintId,
          triggeredByUserId: userId,
        });
      } else if (sync.syncType === 'kanban') {
        await perfSyncQueue.add('sync-sprint-performance', {
          projectId,
          fromDate: sync.startDate,
          toDate: sync.endDate,
          label: sync.periodLabel ?? sync.sprintName,
          triggeredByUserId: userId,
        });
      } else {
        res.status(400).json({ error: 'Cannot determine sync type for retry' });
        return;
      }

      res.json({ success: true, message: 'Sync retry queued' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** DELETE /report/project/:projectId/perf/sync/:syncId
   *  Deletes a sync record and all associated ticket facts + member scores.
   */
  async deleteSync(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const syncId = parseInt(req.params.syncId as string);

      const sync = await PerfSprintSync.findOne({ where: { id: syncId, projectId } });
      if (!sync) {
        res.status(404).json({ error: 'Sync record not found' });
        return;
      }
      if (sync.syncStatus === 'pending' || sync.syncStatus === 'running') {
        res.status(400).json({ error: 'Cannot delete a sync that is currently running' });
        return;
      }

      // Cascade handled by DB FK constraints (ON DELETE CASCADE on perf_ticket_facts and perf_member_scores)
      await sync.destroy();
      res.json({ success: true, message: 'Sync deleted' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
  /** GET /report/productivity-overview */
  async getProductivityOverview(req: Request, res: Response): Promise<void> {
    try {
      const v2Only = req.query.v2Only === 'true';
      const accountId = req.query.accountId ? parseInt(req.query.accountId as string) : undefined;
      const result = await performanceSyncService.getProductivityOverview(v2Only, accountId);
      if (accountId) {
        result.projects = await scopeToAccessibleProjects((req as any).user, accountId, result.projects);
      }
      res.json({ success: true, data: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** GET /report/productivity-overview/:projectId/legacy-sprint-view */
  async getLegacySprintView(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const result = await performanceSyncService.getLegacySprintView(projectId);
      if (!result) {
        res.status(404).json({ error: 'No sprint-era history found for this project' });
        return;
      }
      res.json({ success: true, data: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /** GET /report/quality-trends-overview */
  async getQualityTrendsOverview(req: Request, res: Response): Promise<void> {
    try {
      const v2Only = req.query.v2Only === 'true';
      const accountId = req.query.accountId ? parseInt(req.query.accountId as string) : undefined;
      const result = await performanceSyncService.getQualityTrendsOverview(v2Only, accountId);
      if (accountId) {
        result.projects = await scopeToAccessibleProjects((req as any).user, accountId, result.projects);
      }
      res.json({ success: true, data: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * GET /report/team-performance/trends/download
   * Downloads the Trends section (Productivity, Defect Density, Reopen Ratio) as
   * an HTML or Excel file. Pass projectId to scope to a single project; omit it
   * to download every project in the account together.
   */
  async downloadTrendsReport(req: Request, res: Response): Promise<void> {
    try {
      const accountId = req.query.accountId ? parseInt(req.query.accountId as string) : undefined;
      const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;
      const format = req.query.format as string;
      if (!accountId) {
        res.status(400).json({ error: 'accountId is required' });
        return;
      }
      if (format !== 'html' && format !== 'xlsx') {
        res.status(400).json({ error: "format must be 'html' or 'xlsx'" });
        return;
      }

      let byProject = await getMergedTrendsData(accountId, projectId);
      byProject = await scopeToAccessibleProjects((req as any).user, accountId, byProject);
      if (byProject.length === 0) {
        res.status(404).json({ error: 'No trends data found for this account/project.' });
        return;
      }

      const scopeLabel = projectId ? byProject[0].projectName : byProject[0].accountName;
      const slug = scopeLabel.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const fileBase = `${slug}-team-performance-trends`;

      if (format === 'html') {
        const html = buildTrendsHtml(byProject, `${scopeLabel} — Team Performance Trends`);
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.html"`);
        res.send(html);
      } else {
        const wb = await buildTrendsWorkbook(byProject);
        const buffer = await wb.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
        res.send(Buffer.from(buffer));
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * GET /report/executive/quality-trends-overview
   * Same trends payload as getQualityTrendsOverview, but the project set is
   * narrowed to the caller's accessible projects within the account. Superuser
   * and admin see the full account; everyone else (executive, lead, manager)
   * is intersected with their UserPermission scope so a customer only ever
   * sees the projects assigned to them.
   */
  async getExecutiveQualityTrendsOverview(req: Request, res: Response): Promise<void> {
    try {
      const user = (req as any).user;
      const accountId = req.query.accountId ? parseInt(req.query.accountId as string) : undefined;
      if (!accountId) {
        res.status(400).json({ error: 'accountId is required' });
        return;
      }
      const result = await performanceSyncService.getQualityTrendsOverview(false, accountId);
      result.projects = await scopeToAccessibleProjects(user, accountId, result.projects);
      res.json({ success: true, data: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
}

export const performanceSyncController = new PerformanceSyncController();
