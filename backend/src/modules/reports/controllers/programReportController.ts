import { Request, Response } from 'express';
import fs from 'fs';
import { programReportService } from '../services/programReportService';
import { monthlyProgramReportService } from '../services/monthlyProgramReportService';
import { programDailyReportService } from '../services/programDailyReportService';
import { programDailyReportQueue } from '../queues/programDailyReportQueue';
import { programWeeklyReportQueue } from '../queues/programWeeklyReportQueue';
import { programMonthlyReportQueue } from '../queues/programMonthlyReportQueue';
import { ProgramWeeklyReport } from '../../../models/ProgramWeeklyReport';
import { ProgramMonthlyReport } from '../../../models/ProgramMonthlyReport';
import { pptGenerator } from '../../../common/utils/pptGenerator';

interface AuthRequest extends Request {
    user?: any;
}

class ProgramReportController {
    async generateDaily(req: AuthRequest, res: Response): Promise<void> {
        try {
            const programId = parseInt(req.params.programId as string);
            const { date, force } = req.body;
            const forceRefresh = String(force ?? '').toLowerCase() === 'true' || force === true;
            const report = await programDailyReportService.generateDailyProgramReport(
                programId,
                date,
                forceRefresh
            );
            res.json({ success: true, data: report });
        } catch (error: any) {
            console.error('Error generating program daily report:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    async listDaily(req: AuthRequest, res: Response): Promise<void> {
        try {
            const programId = parseInt(req.params.programId as string);
            const page = req.query.page ? parseInt(req.query.page as string) : 1;
            const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
            const result = await programDailyReportService.listByProgram(programId, { page, limit });
            res.json({ success: true, data: result });
        } catch (error: any) {
            console.error('Error listing program daily reports:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    async generateWeekly(req: AuthRequest, res: Response): Promise<void> {
        try {
            const programId = parseInt(req.params.programId as string);
            const { startDate, endDate, force } = req.body;
            const forceRefresh = String(force ?? '').toLowerCase() === 'true' || force === true;
            const report = await programReportService.generateProgramWeeklyReport(programId, startDate, endDate, forceRefresh);
            res.json({ success: true, data: report });
        } catch (error: any) {
            console.error('Error generating program weekly report:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    async listWeekly(req: AuthRequest, res: Response): Promise<void> {
        try {
            const programId = parseInt(req.params.programId as string);
            const page = req.query.page ? parseInt(req.query.page as string) : 1;
            const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
            const result = await programReportService.listByProgram(programId, { page, limit });
            res.json({ success: true, data: result });
        } catch (error: any) {
            console.error('Error listing program weekly reports:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    async generateMonthly(req: AuthRequest, res: Response): Promise<void> {
        try {
            const programId = parseInt(req.params.programId as string);
            const { month, year, force } = req.body;
            const forceRefresh = String(force ?? '').toLowerCase() === 'true' || force === true;
            const report = await monthlyProgramReportService.generateMonthlyProgramReport(
                programId,
                month ? Number(month) : undefined,
                year ? Number(year) : undefined,
                forceRefresh
            );
            res.json({ success: true, data: report });
        } catch (error: any) {
            console.error('Error generating monthly program report:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    async listMonthly(req: AuthRequest, res: Response): Promise<void> {
        try {
            const programId = parseInt(req.params.programId as string);
            const page = req.query.page ? parseInt(req.query.page as string) : 1;
            const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
            const result = await monthlyProgramReportService.listByProgram(programId, { page, limit });
            res.json({ success: true, data: result });
        } catch (error: any) {
            console.error('Error listing program monthly reports:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    // ── PPT downloads ────────────────────────────────────────────────────────────

    async downloadWeekly(req: AuthRequest, res: Response): Promise<void> {
        try {
            const programId = parseInt(req.params.programId as string);
            const weekNumber = req.query.weekNumber ? parseInt(req.query.weekNumber as string) : undefined;
            const year = req.query.year ? parseInt(req.query.year as string) : undefined;

            if (!weekNumber || !year) {
                res.status(400).json({ error: 'weekNumber and year are required' });
                return;
            }

            const report = await ProgramWeeklyReport.findOne({ where: { programId, weekNumber, year } });
            if (!report) {
                res.status(404).json({ error: 'Report not found' });
                return;
            }

            // Reports predating PPT support have no filePath, and a deck can be stale
            // or pruned. Re-render from stored data — never re-run the AI here, that
            // would rewrite the report's content as a side effect of a download.
            let filePath: string | undefined = report.filePath;
            if (!filePath || !pptGenerator.isDeckCurrent(filePath) || !fs.existsSync(filePath)) {
                filePath = await programReportService.renderDeckFromStored(report);
            }

            if (!filePath || !fs.existsSync(filePath)) {
                res.status(404).json({ error: 'Report file could not be generated' });
                return;
            }

            res.download(filePath, pptGenerator.friendlyDeckName(filePath));
        } catch (error: any) {
            console.error('Error downloading program weekly report:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    async downloadMonthly(req: AuthRequest, res: Response): Promise<void> {
        try {
            const programId = parseInt(req.params.programId as string);
            const month = req.query.month ? parseInt(req.query.month as string) : undefined;
            const year = req.query.year ? parseInt(req.query.year as string) : undefined;

            if (!month || !year) {
                res.status(400).json({ error: 'month and year are required' });
                return;
            }

            const report = await ProgramMonthlyReport.findOne({ where: { programId, month, year } });
            if (!report) {
                res.status(404).json({ error: 'Report not found' });
                return;
            }

            // See downloadWeekly — re-render from stored data, never re-run the AI.
            let filePath: string | undefined = report.filePath;
            if (!filePath || !pptGenerator.isDeckCurrent(filePath) || !fs.existsSync(filePath)) {
                filePath = await monthlyProgramReportService.renderDeckFromStored(report);
            }

            if (!filePath || !fs.existsSync(filePath)) {
                res.status(404).json({ error: 'Report file could not be generated' });
                return;
            }

            res.download(filePath, pptGenerator.friendlyDeckName(filePath));
        } catch (error: any) {
            console.error('Error downloading program monthly report:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    // ── Async queue enqueue endpoints (return 202 immediately) ───────────────────

    async enqueueDaily(req: AuthRequest, res: Response): Promise<void> {
        try {
            const programId = parseInt(req.params.programId as string);
            const { date } = req.body;
            const reportDate = (date && /^\d{4}-\d{2}-\d{2}$/.test(date))
                ? date
                : new Date().toISOString().slice(0, 10);
            const jobId = `program-daily-${programId}-${reportDate}`;
            // Clear any stale completed/failed job with the same id so the user can re-queue.
            // BullMQ otherwise silently drops duplicate jobIds while a prior record sits in Redis.
            await programDailyReportQueue.remove(jobId).catch(() => undefined);
            await programDailyReportQueue.add('generate', { programId, date: reportDate }, { jobId });
            res.status(202).json({ success: true, jobId, message: 'Queued — refresh shortly to view' });
        } catch (error: any) {
            console.error('Error queuing daily program report:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    async enqueueWeekly(req: AuthRequest, res: Response): Promise<void> {
        try {
            const programId = parseInt(req.params.programId as string);
            const { startDate, endDate } = req.body;
            if (!startDate || !endDate) {
                res.status(400).json({ error: 'startDate and endDate are required' });
                return;
            }
            const jobId = `program-weekly-${programId}-${startDate}`;
            await programWeeklyReportQueue.remove(jobId).catch(() => undefined);
            await programWeeklyReportQueue.add('generate', { programId, startDate, endDate }, { jobId });
            res.status(202).json({ success: true, jobId, message: 'Queued — refresh shortly to view' });
        } catch (error: any) {
            console.error('Error queuing weekly program report:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
        }
    }

    async enqueueMonthly(req: AuthRequest, res: Response): Promise<void> {
        try {
            const programId = parseInt(req.params.programId as string);
            const { month, year } = req.body;
            if (!month || !year) {
                res.status(400).json({ error: 'month and year are required' });
                return;
            }
            const jobId = `program-monthly-${programId}-${year}-${month}`;
            await programMonthlyReportQueue.remove(jobId).catch(() => undefined);
            await programMonthlyReportQueue.add(
                'generate',
                { programId, month: Number(month), year: Number(year) },
                { jobId }
            );
            res.status(202).json({ success: true, jobId, message: 'Queued — refresh shortly to view' });
        } catch (error: any) {
            console.error('Error queuing monthly program report:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
        }
    }
}

export const programReportController = new ProgramReportController();
