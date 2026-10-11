import { Request, Response } from 'express';
import { teamPerformanceService } from '../services/teamPerformanceService';

class TeamPerformanceController {
  async listSprints(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const sprints = await teamPerformanceService.listJiraSprints(projectId);
      res.json({ success: true, data: sprints });
    } catch (e) {
      const err = e as { response?: { status?: number }; status?: number; message?: string };
      res.status(500).json({ error: err.message });
    }
  }

  async generateReport(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const { sprintId, memberJiraIds } = req.body;

      if (!sprintId || !Array.isArray(memberJiraIds) || memberJiraIds.length === 0) {
        res.status(400).json({ error: 'sprintId and memberJiraIds[] are required' });
        return;
      }

      const result = await teamPerformanceService.generateReport({
        projectId,
        sprintId: parseInt(String(sprintId)),
        memberJiraIds,
      });
      res.json({ success: true, data: result });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'An unexpected error occurred';
      res.status(500).json({ error: errorMessage });
    }
  }

  async getMemberDeliveryMatrix(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const memberJiraId = req.query.memberJiraId as string;
      const rawIds = req.query.sprintIds;
      const sprintIds: number[] = (Array.isArray(rawIds) ? rawIds : rawIds ? [rawIds] : [])
        .map(Number)
        .filter(n => !isNaN(n));

      if (!memberJiraId) {
        res.status(400).json({ error: 'memberJiraId query param is required' });
        return;
      }
      if (sprintIds.length === 0) {
        res.status(400).json({ error: 'At least one sprintIds[] query param is required' });
        return;
      }

      const result = await teamPerformanceService.generateMemberDeliveryMatrix({ projectId, memberJiraId, sprintIds });
      res.json({ success: true, data: result });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'An unexpected error occurred';
      res.status(500).json({ error: errorMessage });
    }
  }

  async getTeamDashboard(req: Request, res: Response): Promise<void> {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const { memberJiraIds } = req.body;

      if (!Array.isArray(memberJiraIds) || memberJiraIds.length === 0) {
        res.status(400).json({ error: 'memberJiraIds[] is required' });
        return;
      }

      const result = await teamPerformanceService.generateTeamDashboard({ projectId, memberJiraIds });
      res.json({ success: true, data: result });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'An unexpected error occurred';
      res.status(500).json({ error: errorMessage });
    }
  }

}

export const teamPerformanceController = new TeamPerformanceController();
