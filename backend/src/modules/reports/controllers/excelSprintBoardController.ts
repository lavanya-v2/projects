import { Request, Response } from 'express';
import { excelSprintBoardService } from '../services/excelSprintBoardService';

class ExcelSprintBoardController {
    async listSprints(req: Request, res: Response): Promise<void> {
        try {
            const projectId = parseInt(req.params.projectId as string);
            const sprints = await excelSprintBoardService.listSprints(projectId);
            res.json({ success: true, data: sprints });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: message });
        }
    }

    async getScorecard(req: Request, res: Response): Promise<void> {
        try {
            const projectId = parseInt(req.params.projectId as string);
            const sprintName = (req.query.sprint as string) || '';
            if (!sprintName) {
                res.status(400).json({ error: 'sprint query param is required' });
                return;
            }
            const scorecard = await excelSprintBoardService.getScorecard(projectId, sprintName);
            res.json({ success: true, data: scorecard });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            res.status(500).json({ error: message });
        }
    }
}

export const excelSprintBoardController = new ExcelSprintBoardController();
