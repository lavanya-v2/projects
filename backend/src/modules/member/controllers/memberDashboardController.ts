import { Request, Response } from 'express';
import { memberDashboardService } from '../services/memberDashboardService';

interface AuthRequest extends Request {
    user?: any;
}

export const memberDashboardController = {
    async getDashboard(req: AuthRequest, res: Response) {
        try {
            const data = await memberDashboardService.getDashboard(req.user);
            res.json({ success: true, data });
        } catch (error) {
            console.error('Error building member dashboard:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async getTechNotesGap(req: AuthRequest, res: Response) {
        try {
            const projectId = parseInt(req.params.projectId as string, 10);
            if (Number.isNaN(projectId)) {
                return res.status(400).json({ error: 'Invalid project id' });
            }
            const data = await memberDashboardService.getTechNotesGap(req.user, projectId);
            res.json({ success: true, data });
        } catch (error) {
            console.error('Error fetching tech-notes gap:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async getAutomationLabels(req: AuthRequest, res: Response) {
        try {
            const projectId = parseInt(req.params.projectId as string, 10);
            if (Number.isNaN(projectId)) {
                return res.status(400).json({ error: 'Invalid project id' });
            }
            const data = await memberDashboardService.getAutomationLabels(req.user, projectId);
            res.json({ success: true, data });
        } catch (error) {
            console.error('Error fetching automation labels:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
