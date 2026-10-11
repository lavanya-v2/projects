import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { reportService } from '../services/reportService';
import { logger } from '../../../common/utils';
import { config } from '../../../config';
import { dsrQueue } from '../queues/dsrQueue';
import {
    istDateStr,
    dsrJobId,
    weeklyJobId,
    accountWeeklyJobId,
    monthlyJobId,
    monthlyAccountJobId,
} from '../queues/jobIds';
import { pptGenerator } from '../../../common/utils/pptGenerator';

import { Op } from 'sequelize';
import { AccountWeeklyReport } from '../../../models/AccountWeeklyReport';
import { MonthlyAccountReport } from '../../../models/MonthlyAccountReport';
import { UserPermission } from '../../../models/UserPermission';
import { Project } from '../../../models/Project';
import { Account } from '../../../models/Account';
import { normalizeWindow } from '../services/reportWindow';

export class ReportController {
    async generateReport(req: Request, res: Response): Promise<void> {
        try {
            const { projectName, date } = req.body;

            if (!projectName) {
                res.status(400).json({ error: 'projectName is required' });
                return;
            }

            logger.info(`API Request: Fetch report for Project ${projectName}`, 'ReportController');

            // Process the board (Now strictly fetches from DB)
            const report = await reportService.processBoard(projectName, date || null);

            if (!report) {
                // Return 200 with Empty Data (or 404 per REST, but user said "no data to be presented")
                // Usually 404 is cleaner, but let's stick to existing behavior or returning null data object?
                // Existing code returned 404. I will keep it consistent.
                res.status(404).json({ error: 'No report data found. Please try "Queue your request" option to generate it, and check back in 2 minutes.' });
                return;
            }

            // Generate reports (File generation disabled)
            // await reportService.generateReports([report], projectName || null);

            res.json({
                success: true,
                message: 'Report fetched successfully',
                data: {
                    boardName: report.boardName,
                    analysis: report.data
                }
            });
        } catch (error: any) {
            console.error('Error fetching report:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                details: error.message
            });
        }
    }

    async generateAsyncReport(req: Request, res: Response): Promise<void> {
        try {
            const { projectName, date } = req.body;

            if (!projectName) {
                res.status(400).json({ error: 'projectName is required' });
                return;
            }

            logger.info(`API Request: Async Generate report for Project ${projectName}`, 'ReportController');

            // Same jobId the scheduler uses, so a manual run replaces that night's scheduled
            // job instead of duplicating it. Clear any stale completed/failed record first —
            // BullMQ otherwise silently drops the add while removeOnFail keeps it in Redis.
            const jobId = dsrJobId(projectName, date || istDateStr());
            await dsrQueue.remove(jobId).catch(() => undefined);
            await dsrQueue.add('generate-dsr', {
                projectName,
                date: date || null
            }, { jobId });

            res.status(200).json({
                success: true,
                message: `Processing the request to generate DSR For ${projectName}, It will take anywhere from 30 seconds to 2 minutes`
            });
        } catch (error: any) {
            console.error('Error queuing async report:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                details: error.message
            });
        }
    }

    async healthCheck(req: Request, res: Response): Promise<void> {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            config: {
                jiraConfigured: !!config.jira.baseUrl,
                aiConfigured: !!config.anthropic.apiKey && config.anthropic.apiKey !== 'sk-dummy-key',
                dbConfigured: !!config.postgres.database
            }
        });
    }
    async downloadReport(req: Request, res: Response): Promise<void> {
        try {
            const projectName = req.query.projectName as string;
            const date = req.query.date as string; // Expected format: YYYY-MM-DD

            if (!projectName || !date) {
                res.status(400).json({ error: 'projectName and date are required' });
                return;
            }

            // Convert YYYY-MM-DD to DD_MM_YYYY
            const [year, month, day] = date.split('-');
            const formattedDate = `${day}_${month}_${year}`;

            const fileName = `Daily_Status_${projectName}_${formattedDate}.xlsx`;
            const filePath = path.resolve(__dirname, '../../../../../reports', fileName);

            if (!fs.existsSync(filePath)) {
                res.status(404).json({ error: 'Report file not found' });
                return;
            }

            res.download(filePath, fileName);
        } catch (error: any) {
            console.error('Error downloading report:', error);
            res.status(500).json({ error: 'Failed to download report' });
        }
    }
    async generateWeeklyReport(req: Request, res: Response): Promise<void> {
        try {
            const { projectName, startDate, endDate, force } = req.body;

            if (!projectName) { // startDate/endDate are optional now
                res.status(400).json({ error: 'projectName is required' });
                return;
            }

            logger.info(`API Request: Generate Weekly Report for ${projectName}`, 'ReportController');

            if (force === true) {
                // The queued path below never runs reportService.generateWeeklyReport
                // synchronously, so without a pre-flight check here a bad window would be
                // silently queued and fail invisibly in the worker later, with no error ever
                // reaching this caller. Validate against the same canonical rule the sync path
                // uses (Phase 4 of the RAG-reliability plan), rather than a separate, weaker,
                // drift-prone copy of the checks.
                //
                // Must resolve the project's account's configured weekStartDay before validating
                // -- calling normalizeWindow without it silently assumes Friday for every account,
                // rejecting a correctly-configured non-Friday account's own valid dates (the bug
                // this comment replaces: this pre-flight check was never updated when
                // Account.weekStartDay was introduced, even though reportService.ts itself was).
                if (startDate && endDate) {
                    try {
                        const preflightProject = await Project.findOne({ where: { code: projectName } });
                        const preflightAccount = preflightProject
                            ? await Account.findByPk(preflightProject.accountId)
                            : null;
                        const preflightWeekStartDay = preflightAccount?.weekStartDay ?? 5;
                        normalizeWindow(startDate, endDate, 'fri-thu-week', preflightWeekStartDay);
                    } catch (validationError: any) {
                        res.status(400).json({ error: validationError.message });
                        return;
                    }
                }

                const { weeklyReportQueue } = require('../queues/weeklyReportQueue');
                // Match the scheduler's jobId so a manual run replaces the scheduled one rather
                // than duplicating it. Only when the week is explicit — an id built from an
                // undefined startDate would wrongly collide across different weeks.
                const opts: { jobId?: string } = {};
                if (startDate) {
                    opts.jobId = weeklyJobId(projectName, startDate);
                    await weeklyReportQueue.remove(opts.jobId).catch(() => undefined);
                }
                await weeklyReportQueue.add('generate-weekly-report', {
                    projectName,
                    startDate,
                    endDate
                }, opts);

                res.status(200).json({
                    success: true,
                    message: "Processing the request to generate Weekly Project Report. It may take up to a minute.",
                    data: {
                        isAsync: true,
                        message: "Processing the request to generate Weekly Project Report. It may take up to a minute."
                    }
                });
                return;
            }

            const report = await reportService.generateWeeklyReport(projectName, startDate, endDate, force);

            res.json({
                success: true,
                message: 'Weekly report generated successfully',
                data: report
            });
        } catch (error: any) {
            console.error('Error generating weekly report:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                details: error.message
            });
        }
    }

    async generateAccountWeeklyReport(req: Request, res: Response): Promise<void> {
        try {
            const { accountId, startDate, endDate, force } = req.body;

            if (!accountId) {
                res.status(400).json({ error: 'accountId is required' });
                return;
            }

            logger.info(`API Request: Generate Account Weekly Report for Account ${accountId} (Force: ${force})`, 'ReportController');

            if (force === true) {
                // Same reasoning as generateWeeklyReport above: pre-flight validate against
                // the canonical rule before queueing, since the queued path skips the sync
                // service call that would otherwise catch a bad window.
                //
                // Must resolve the account's configured weekStartDay before validating -- see the
                // identical fix/comment in generateWeeklyReport above.
                if (startDate && endDate) {
                    try {
                        const preflightAccount = await Account.findByPk(accountId);
                        const preflightWeekStartDay = preflightAccount?.weekStartDay ?? 5;
                        normalizeWindow(startDate, endDate, 'fri-thu-week', preflightWeekStartDay);
                    } catch (validationError: any) {
                        res.status(400).json({ error: validationError.message });
                        return;
                    }
                }

                // Async Generation path
                const { accountReportQueue } = require('../queues/accountReportQueue'); // Lazy load

                const opts: { jobId?: string } = {};
                if (startDate) {
                    opts.jobId = accountWeeklyJobId(accountId, startDate);
                    await accountReportQueue.remove(opts.jobId).catch(() => undefined);
                }
                await accountReportQueue.add('generate-account-report', {
                    accountId,
                    startDate,
                    endDate
                }, opts);

                res.status(200).json({
                    success: true,
                    message: "Processing the request to generate Account Weekly Report. It may take up to three minutes.",
                    data: {
                        isAsync: true,
                        message: "Processing the request to generate Account Weekly Report. It may take up to three minutes."
                    }
                });
                return;
            }

            // Sync Path (Usually fetching from DB when force=false)
            const { accountReportService } = require('../services/accountReportService'); // Lazy load
            const report = await accountReportService.generateAccountWeeklyReport(accountId, startDate, endDate, force);

            res.json({
                success: true,
                message: 'Account weekly report generated successfully',
                data: report
            });
        } catch (error: any) {
            console.error('Error generating account report:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                details: error.message
            });
        }
    }

    async listAccountWeeklyReports(req: Request, res: Response): Promise<void> {
        try {
            const { accountId } = req.params;
            const { page = 1, limit = 10, status, health } = req.query;

            if (!accountId) {
                res.status(400).json({ error: 'accountId is required' });
                return;
            }

            const pageNum = parseInt(page as string, 10) || 1;
            const limitNum = parseInt(limit as string, 10) || 10;
            const offset = (pageNum - 1) * limitNum;

            // Lazy load model
            const { AccountWeeklyReport } = require('../../../models/AccountWeeklyReport');

            const whereClause: any = {
                accountId: parseInt(accountId as string, 10)
            };

            if (health && health !== 'All') {
                whereClause.health = health;
            }

            // Note: status (Available/Missing) might require logic depending on if 'Missing' 
            // is stored in the DB. Typically, only existing reports are in the DB.
            // If we filter by Available, it's just what we have. 
            // Missing reports are generated on the frontend, so the backend only ever returns 'Available' reports.

            const { rows: reports, count } = await AccountWeeklyReport.findAndCountAll({
                where: whereClause,
                order: [['startDate', 'DESC']],
                limit: limitNum,
                offset: offset
            });

            res.json({
                success: true,
                message: 'Account weekly reports fetched successfully',
                data: {
                    reports,
                    total: count,
                    page: pageNum,
                    totalPages: Math.ceil(count / limitNum)
                }
            });

        } catch (error: any) {
            console.error('Error listing account weekly reports:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                details: error.message
            });
        }
    }

    async generateMonthlyProjectReport(req: Request, res: Response): Promise<void> {
        try {
            const { projectId, month, year, force } = req.body;

            if (!projectId) {
                res.status(400).json({ error: 'projectId is required' });
                return;
            }

            logger.info(`API Request: Generate Monthly Report for Project ${projectId}`, 'ReportController');

            if (force === true) {
                const { monthlyReportQueue } = require('../queues/monthlyReportQueue');
                const opts: { jobId?: string } = {};
                if (month && year) {
                    opts.jobId = monthlyJobId(projectId, month, year);
                    await monthlyReportQueue.remove(opts.jobId).catch(() => undefined);
                }
                await monthlyReportQueue.add('generate-monthly-report', {
                    projectId,
                    month,
                    year
                }, opts);

                res.status(200).json({
                    success: true,
                    message: "Processing the request to generate Monthly Project Report. It may take up to a minute.",
                    data: {
                        isAsync: true,
                        message: "Processing the request to generate Monthly Project Report. It may take up to a minute."
                    }
                });
                return;
            }

            const { monthlyReportService } = require('../services/monthlyReportService'); // Lazy load
            const report = await monthlyReportService.generateProjectMonthlyReport(projectId, month, year, force);

            res.json({
                success: true,
                message: 'Monthly project report generated successfully',
                data: report
            });
        } catch (error: any) {
            console.error('Error generating monthly report:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                details: error.message
            });
        }
    }

    async listProjectWeeklyReports(req: Request, res: Response): Promise<void> {
        try {
            const { projectId } = req.params;
            const { page = 1, limit = 10, status } = req.query;

            if (!projectId) {
                res.status(400).json({ error: 'projectId is required' });
                return;
            }

            const pageNum = parseInt(page as string, 10) || 1;
            const limitNum = parseInt(limit as string, 10) || 10;
            const offset = (pageNum - 1) * limitNum;

            const { ProjectWeeklyReport } = require('../../../models/ProjectWeeklyReport');

            const whereClause: any = {
                projectId: parseInt(projectId as string, 10)
            };

            if (status && status !== 'All') {
                whereClause.status = status;
            }

            const { rows: reports, count } = await ProjectWeeklyReport.findAndCountAll({
                where: whereClause,
                order: [['startDate', 'DESC']],
                limit: limitNum,
                offset: offset,
                attributes: ['id', 'projectId', 'startDate', 'endDate', 'weekNumber', 'year', 'executiveSummary', 'workSummary', 'risks', 'achievements', 'status', 'additionalNotes', 'teamNotes', 'createdAt', 'updatedAt']
            });

            const totalPages = Math.ceil(count / limitNum);

            res.json({
                success: true,
                message: 'Project weekly reports fetched successfully',
                data: {
                    reports,
                    total: count,
                    page: pageNum,
                    totalPages
                }
            });
        } catch (error: any) {
            console.error('Error fetching project weekly reports:', error);
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }

    async listProjectMonthlyReports(req: Request, res: Response): Promise<void> {
        try {
            const { projectId } = req.params;
            const { page = 1, limit = 10, status } = req.query;

            if (!projectId) {
                res.status(400).json({ error: 'projectId is required' });
                return;
            }

            const pageNum = parseInt(page as string, 10) || 1;
            const limitNum = parseInt(limit as string, 10) || 10;
            const offset = (pageNum - 1) * limitNum;

            const { MonthlyProjectReport } = require('../../../models/MonthlyProjectReport');

            const whereClause: any = {
                projectId: parseInt(projectId as string, 10)
            };

            if (status && status !== 'All') {
                whereClause.status = status;
            }

            const { rows: reports, count } = await MonthlyProjectReport.findAndCountAll({
                where: whereClause,
                order: [['year', 'DESC'], ['month', 'DESC']],
                limit: limitNum,
                offset: offset,
                attributes: ['id', 'projectId', 'month', 'year', 'workSummary', 'risks', 'achievements', 'status', 'teamNotes', 'createdAt', 'updatedAt']
            });

            const totalPages = Math.ceil(count / limitNum);

            res.json({
                success: true,
                message: 'Project monthly reports fetched successfully',
                data: {
                    reports,
                    total: count,
                    page: pageNum,
                    totalPages
                }
            });
        } catch (error: any) {
            console.error('Error fetching project monthly reports:', error);
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }

    async listProjectDailyReports(req: Request, res: Response): Promise<void> {
        try {
            const { projectId } = req.params;
            const { page = 1, limit = 10, startDate, endDate } = req.query;

            if (!projectId) {
                res.status(400).json({ error: 'projectId is required' });
                return;
            }

            const pageNum = parseInt(page as string, 10) || 1;
            const limitNum = parseInt(limit as string, 10) || 10;
            const offset = (pageNum - 1) * limitNum;

            // Lazy load model
            const { DailyBoardSnapshot } = require('../../../models/DailyBoardSnapshot');

            const whereClause: any = {
                projectId: parseInt(projectId as string, 10)
            };

            // Date filtering
            const { Op } = require('sequelize');
            if (startDate && endDate) {
                whereClause.date = {
                    [Op.between]: [startDate, endDate]
                };
            } else if (startDate) {
                whereClause.date = {
                    [Op.gte]: startDate
                };
            } else if (endDate) {
                whereClause.date = {
                    [Op.lte]: endDate
                };
            } else {
                // Default handling: fetch last 7 days from today
                const dayjs = require('dayjs');
                const defaultStart = dayjs().subtract(7, 'day').format('YYYY-MM-DD');
                const defaultEnd = dayjs().format('YYYY-MM-DD');
                whereClause.date = {
                    [Op.between]: [defaultStart, defaultEnd]
                };
            }

            const { rows: reports, count } = await DailyBoardSnapshot.findAndCountAll({
                where: whereClause,
                order: [['date', 'DESC']],
                limit: limitNum,
                offset: offset,
            });

            const totalPages = Math.ceil(count / limitNum);

            // Compute activity window for each snapshot:
            //   end   = this snapshot's updatedAt (when the report was generated)
            //   start = previous snapshot's updatedAt (or fallback: prev day 18:30 IST)
            // Reports are sorted DESC by date, so the previous snapshot for reports[i]
            // is reports[i+1]. For the oldest item in the page, fetch one older row.
            let olderThanPage: any = null;
            if (reports.length > 0) {
                const oldestInPage = reports[reports.length - 1];
                olderThanPage = await DailyBoardSnapshot.findOne({
                    where: {
                        projectId: parseInt(projectId as string, 10),
                        date: { [Op.lt]: oldestInPage.date }
                    },
                    order: [['date', 'DESC']],
                    attributes: ['id', 'date', 'updated_at']
                });
            }

            const reportsWithWindow = reports.map((snap: any, idx: number) => {
                const previous = idx < reports.length - 1 ? reports[idx + 1] : olderThanPage;
                const reportWindow = this.computeDailyReportWindow(snap, previous);
                return { ...snap.toJSON(), reportWindow };
            });

            res.json({
                success: true,
                message: 'Project daily reports fetched successfully',
                data: {
                    reports: reportsWithWindow,
                    total: count,
                    page: pageNum,
                    totalPages
                }
            });
        } catch (error: any) {
            console.error('Error fetching project daily reports:', error);
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }

    private formatIstTimestamp(d: Date): string {
        const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
        return ist.toISOString().replace('T', ' ').slice(0, 19);
    }

    private computeDailyReportWindow(snap: any, previous: any): { start: string; end: string } {
        const endRaw = snap?.updatedAt ?? snap?.dataValues?.updatedAt;
        const end = endRaw ? this.formatIstTimestamp(new Date(endRaw)) : 'N/A';

        const prevRaw = previous?.updatedAt ?? previous?.dataValues?.updatedAt;
        let start: string;
        if (prevRaw) {
            start = this.formatIstTimestamp(new Date(prevRaw));
        } else {
            const reportDate = new Date(snap?.date ?? snap?.dataValues?.date);
            const prevDay = new Date(reportDate);
            prevDay.setUTCDate(prevDay.getUTCDate() - 1);
            // Configured IST window start → UTC (IST = UTC + 5:30)
            prevDay.setUTCHours(
                config.reports.windowStartHour - 5,
                config.reports.windowStartMinute - 30,
                0,
                0
            );
            start = this.formatIstTimestamp(prevDay) + ' (Estimated)';
        }
        return { start, end };
    }

    async downloadAccountReport(req: Request, res: Response): Promise<void> {
        try {
            const { accountId, weekNumber, year } = req.query;

            if (!accountId || !weekNumber || !year) {
                res.status(400).json({ error: 'accountId, weekNumber, and year are required' });
                return;
            }

            // Lazy load model
            const { AccountWeeklyReport } = require('../../../models/AccountWeeklyReport');

            const report = await AccountWeeklyReport.findOne({
                where: {
                    accountId,
                    weekNumber,
                    year
                }
            });

            if (!report) {
                res.status(404).json({ error: 'Report file not found' });
                return;
            }

            // Decks are written once at generation time, so a report created before a
            // layout change still points at the old file. Re-render from stored data
            // when the deck is missing or predates the current layout — content is
            // untouched, only the rendering is refreshed.
            let filePath: string | undefined = report.filePath;
            if (!filePath || !pptGenerator.isDeckCurrent(filePath) || !fs.existsSync(filePath)) {
                const { accountReportService } = require('../services/accountReportService');
                filePath = await accountReportService.renderDeckFromStored(report);
            }

            if (!filePath || !fs.existsSync(filePath)) {
                res.status(404).json({ error: 'File on disk not found' });
                return;
            }

            res.download(filePath, pptGenerator.friendlyDeckName(filePath));

        } catch (error: any) {
            console.error('Error downloading account report:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                details: error.message
            });
        }
    }

    async downloadWeeklyReportText(req: Request, res: Response): Promise<void> {
        try {
            const { projectName, startDate, endDate } = req.query;

            if (!projectName || !startDate || !endDate) {
                res.status(400).json({ error: 'projectName, startDate, and endDate are required' });
                return;
            }

            const { Project } = require('../../../models/Project');
            const { ProjectWeeklyReport } = require('../../../models/ProjectWeeklyReport');

            const project = await Project.findOne({ where: { code: projectName as string } });
            if (!project) {
                res.status(404).json({ error: `Project ${projectName} not found` });
                return;
            }

            const report = await ProjectWeeklyReport.findOne({
                where: {
                    projectId: project.id,
                    startDate: startDate as string,
                    endDate: endDate as string
                }
            });

            if (!report) {
                res.status(404).json({ error: `No weekly report found for ${projectName} from ${startDate} to ${endDate}` });
                return;
            }

            const textContent = this.formatWeeklyReportText(report, projectName as string);

            const fileName = `Weekly_Report_${projectName}_${(startDate as string).replace(/-/g, '_')}_to_${(endDate as string).replace(/-/g, '_')}.txt`;
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

            res.send(textContent);
        } catch (error: any) {
            console.error('Error generating weekly report text:', error);
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }

    async downloadWeeklyReportCSV(req: Request, res: Response): Promise<void> {
        try {
            const { projectName, startDate, endDate } = req.query;

            if (!projectName || !startDate || !endDate) {
                res.status(400).json({ error: 'projectName, startDate, and endDate are required' });
                return;
            }

            const { Project } = require('../../../models/Project');
            const { ProjectWeeklyReport } = require('../../../models/ProjectWeeklyReport');

            const project = await Project.findOne({ where: { code: projectName as string } });
            if (!project) {
                res.status(404).json({ error: `Project ${projectName} not found` });
                return;
            }

            const report = await ProjectWeeklyReport.findOne({
                where: {
                    projectId: project.id,
                    startDate: startDate as string,
                    endDate: endDate as string
                }
            });

            if (!report) {
                res.status(404).json({ error: `No weekly report found for ${projectName} from ${startDate} to ${endDate}` });
                return;
            }

            const csvContent = '\ufeff' + this.formatWeeklyReportCSV(report, projectName as string);

            const fileName = `Weekly_Report_${projectName}_${(startDate as string).replace(/-/g, '_')}_to_${(endDate as string).replace(/-/g, '_')}.csv`;
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

            res.send(csvContent);
        } catch (error: any) {
            console.error('Error generating weekly report CSV:', error);
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }

    async downloadWeeklyReportPPT(req: Request, res: Response): Promise<void> {
        try {
            const { projectName, startDate, endDate } = req.query;

            if (!projectName || !startDate || !endDate) {
                res.status(400).json({ error: 'projectName, startDate, and endDate are required' });
                return;
            }

            const { Project } = require('../../../models/Project');
            const { ProjectWeeklyReport } = require('../../../models/ProjectWeeklyReport');

            const project = await Project.findOne({ where: { code: projectName as string } });
            if (!project) {
                res.status(404).json({ error: `Project ${projectName} not found` });
                return;
            }

            const report = await ProjectWeeklyReport.findOne({
                where: { projectId: project.id, startDate: startDate as string, endDate: endDate as string }
            });

            if (!report) {
                res.status(404).json({ error: `No weekly report found for ${projectName} from ${startDate} to ${endDate}` });
                return;
            }

            const filePath = await pptGenerator.generateProjectWeeklyReport({
                projectName: project.name || (projectName as string),
                weekNumber: report.weekNumber,
                year: report.year,
                startDate: report.startDate,
                endDate: report.endDate,
                executiveSummary: report.executiveSummary || '',
                workSummary: report.workSummary || '',
                achievements: report.achievements || '',
                risks: report.risks || '',
                status: report.status || 'Unknown',
                teamMembers: report.teamMembers || []
            });

            const fileName = `Weekly_Report_${(projectName as string).replace(/[^a-z0-9]/gi, '_')}_${(startDate as string).replace(/-/g, '_')}_to_${(endDate as string).replace(/-/g, '_')}.pptx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.download(filePath, fileName, (err) => {
                if (err) console.error('Error sending PPT file:', err);
            });
        } catch (error: any) {
            console.error('Error generating weekly report PPT:', error);
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }

    async bulkDownloadWeeklyReports(req: Request, res: Response): Promise<void> {
        try {
            const { reports, format } = req.body as {
                reports: { projectName: string; startDate: string; endDate: string }[];
                format: 'text' | 'csv' | 'ppt';
            };

            if (!reports || !Array.isArray(reports) || reports.length === 0) {
                res.status(400).json({ error: 'reports array is required' });
                return;
            }
            if (!format || !['text', 'csv', 'ppt'].includes(format)) {
                res.status(400).json({ error: 'format must be text, csv, or ppt' });
                return;
            }

            const { Project } = require('../../../models/Project');
            const { ProjectWeeklyReport } = require('../../../models/ProjectWeeklyReport');

            const archive = archiver('zip', { zlib: { level: 6 } });
            const ext = format === 'ppt' ? 'pptx' : format === 'csv' ? 'csv' : 'txt';
            const zipName = `Weekly_Reports_Bulk_${new Date().toISOString().slice(0, 10)}.zip`;

            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
            archive.pipe(res);

            for (const item of reports) {
                const project = await Project.findOne({ where: { code: item.projectName } });
                if (!project) continue;

                const report = await ProjectWeeklyReport.findOne({
                    where: { projectId: project.id, startDate: item.startDate, endDate: item.endDate }
                });
                if (!report) continue;

                const safeName = item.projectName.replace(/[^a-z0-9]/gi, '_');
                const dateRange = `${item.startDate.replace(/-/g, '_')}_to_${item.endDate.replace(/-/g, '_')}`;

                if (format === 'text') {
                    const content = this.formatWeeklyReportText(report, project.name || item.projectName);
                    archive.append(content, { name: `Weekly_Report_${safeName}_${dateRange}.txt` });
                } else if (format === 'csv') {
                    const content = '\ufeff' + this.formatWeeklyReportCSV(report, project.name || item.projectName);
                    archive.append(content, { name: `Weekly_Report_${safeName}_${dateRange}.csv` });
                } else {
                    const filePath = await pptGenerator.generateProjectWeeklyReport({
                        projectName: project.name || item.projectName,
                        weekNumber: report.weekNumber,
                        year: report.year,
                        startDate: report.startDate,
                        endDate: report.endDate,
                        executiveSummary: report.executiveSummary || '',
                        workSummary: report.workSummary || '',
                        achievements: report.achievements || '',
                        risks: report.risks || '',
                        status: report.status || 'Unknown',
                        teamMembers: report.teamMembers || []
                    });
                    archive.file(filePath, { name: `Weekly_Report_${safeName}_${dateRange}.pptx` });
                }
            }

            await archive.finalize();
        } catch (error: any) {
            console.error('Error bulk downloading weekly reports:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal Server Error', details: error.message });
            }
        }
    }

    private formatWeeklyReportText(report: any, projectName: string): string {
        const separator = '='.repeat(80);
        const sectionSeparator = '-'.repeat(80);

        let content = '';
        content += `${separator}\n`;
        content += `                    WEEKLY PROJECT REPORT\n`;
        content += `${separator}\n\n`;
        content += `Project: ${projectName}\n`;
        content += `Week: ${report.startDate} to ${report.endDate} (Wk ${report.weekNumber}, ${report.year})\n`;
        content += `Overall Health: ${report.status || 'Unknown'}\n`;
        content += `\n${separator}\n\n`;

        content += `EXECUTIVE SUMMARY\n`;
        content += `${sectionSeparator}\n\n`;
        content += `${report.executiveSummary || 'No summary available.'}\n`;
        content += `\n${separator}\n\n`;

        if (report.originalExecutiveSummary && report.originalExecutiveSummary !== report.executiveSummary) {
            content += `ORIGINAL AI SUMMARY (pre-insights)\n`;
            content += `${sectionSeparator}\n\n`;
            content += `${report.originalExecutiveSummary}\n`;
            content += `\n${separator}\n\n`;
        }

        content += `WORK SUMMARY\n`;
        content += `${sectionSeparator}\n\n`;
        content += `${report.workSummary || 'No work summary available.'}\n`;
        content += `\n${separator}\n\n`;

        content += `ACHIEVEMENTS\n`;
        content += `${sectionSeparator}\n\n`;
        content += `${report.achievements || 'No achievements identified.'}\n`;
        content += `\n${separator}\n\n`;

        content += `RISKS\n`;
        content += `${sectionSeparator}\n\n`;
        content += `${report.risks || 'No risks identified.'}\n`;
        content += `\n${separator}\n\n`;

        if (report.teamMembers && report.teamMembers.length > 0) {
            content += `TEAM MEMBERS\n`;
            content += `${sectionSeparator}\n\n`;
            content += `${report.teamMembers.join(', ')}\n`;
            content += `\n${separator}\n\n`;
        }

        content += this.formatInsightsAndNotesText(report, separator, sectionSeparator);

        content += `Report generated on: ${new Date().toLocaleString('en-US')}\n`;
        content += `${separator}\n`;

        return content;
    }

    private formatWeeklyReportCSV(report: any, projectName: string): string {
        const rows = [
            ['Project', projectName],
            ['Week Range', `${report.startDate} to ${report.endDate}`],
            ['Week Number', report.weekNumber],
            ['Year', report.year],
            ['Overall Health', report.status || 'Unknown'],
            [''],
            ['Section', 'Content'],
            ['Executive Summary', report.executiveSummary || ''],
            ['Work Summary', report.workSummary || ''],
            ['Achievements', report.achievements || ''],
            ['Risks', report.risks || ''],
            ['Team Members', (report.teamMembers || []).join('; ')],
            ...this.insightsAndNotesCsvRows(report)
        ];

        return rows.map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    }

    async downloadDailyReportText(req: Request, res: Response): Promise<void> {
        try {
            const { projectName, date } = req.query;

            if (!projectName || !date) {
                res.status(400).json({ error: 'projectName and date are required' });
                return;
            }

            logger.info(`Generating text report for ${projectName} on ${date}`, 'ReportController');

            // Lazy load models
            const { Project } = require('../../../models/Project');
            const { DailyBoardSnapshot } = require('../../../models/DailyBoardSnapshot');

            // 1. Resolve Project
            const project = await Project.findOne({ where: { code: projectName as string } });
            if (!project) {
                res.status(404).json({ error: `Project ${projectName} not found` });
                return;
            }

            // 2. Fetch Daily Snapshot
            const snapshot = await DailyBoardSnapshot.findOne({
                where: {
                    projectId: project.id,
                    date: date as string
                }
            });

            if (!snapshot) {
                res.status(404).json({ error: `No daily report found for ${projectName} on ${date}` });
                return;
            }

            // 3. Calculate Report Window (Dynamic)
            let startWindow = 'N/A';
            let endWindow = 'N/A';

            // End Time: Current Snapshot UpdatedAt (IST)
            if (snapshot.updatedAt) {
                const endDateObj = new Date(snapshot.updatedAt);
                // Convert to IST
                endWindow = endDateObj.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
            }

            // Start Time: Try to find previous snapshot
            const previousSnapshot = await DailyBoardSnapshot.findOne({
                where: {
                    projectId: project.id,
                    date: { [Op.lt]: date as string } // Strictly less than current date
                },
                order: [['date', 'DESC']]
            });

            if (previousSnapshot && previousSnapshot.updatedAt) {
                const startDateObj = new Date(previousSnapshot.updatedAt);
                startWindow = startDateObj.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
            } else {
                // Fallback: Previous Day at the configured IST window start
                const currentReportDate = new Date(date as string);
                const prevDay = new Date(currentReportDate);
                prevDay.setDate(prevDay.getDate() - 1);

                // Configured window-start in IST → UTC (IST = UTC + 5:30)
                prevDay.setUTCHours(
                    config.reports.windowStartHour - 5,
                    config.reports.windowStartMinute - 30,
                    0,
                    0
                );
                startWindow = prevDay.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' (Estimated)';
            }

            const reportWindowStr = `${startWindow} - ${endWindow}`;

            // 4. Format the text file with 4 sections
            const textContent = this.formatDailyReportText(snapshot, projectName as string, date as string, reportWindowStr);

            // 5. Set headers for file download
            const fileName = `Daily_Report_${projectName}_${(date as string).replace(/-/g, '_')}.txt`;
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

            // 6. Send the text content
            res.send(textContent);

        } catch (error: any) {
            console.error('Error generating daily report text:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                details: error.message
            });
        }
    }

    async downloadDailyReportCSV(req: Request, res: Response): Promise<void> {
        try {
            const { projectName, date } = req.query;

            if (!projectName || !date) {
                res.status(400).json({ error: 'projectName and date are required' });
                return;
            }

            logger.info(`Generating CSV report for ${projectName} on ${date}`, 'ReportController');

            const { Project } = require('../../../models/Project');
            const { DailyBoardSnapshot } = require('../../../models/DailyBoardSnapshot');

            const project = await Project.findOne({ where: { code: projectName as string } });
            if (!project) {
                res.status(404).json({ error: `Project ${projectName} not found` });
                return;
            }

            const snapshot = await DailyBoardSnapshot.findOne({
                where: {
                    projectId: project.id,
                    date: date as string
                }
            });

            if (!snapshot) {
                res.status(404).json({ error: `No daily report found for ${projectName} on ${date}` });
                return;
            }

            const csvContent = '\ufeff' + this.formatDailyReportCSV(snapshot, projectName as string, date as string);

            const fileName = `Daily_Report_${projectName}_${(date as string).replace(/-/g, '_')}.csv`;
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

            res.send(csvContent);

        } catch (error: any) {
            console.error('Error generating daily report CSV:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                details: error.message
            });
        }
    }

    /** Resolves sprint fields with fallbacks for old snapshots that predate the days/offtrack columns */
    private resolveSprintFields(sb: any) {
        const countWeekdays = (from: Date, to: Date): number => {
            let count = 0;
            const cur = new Date(from);
            cur.setHours(0, 0, 0, 0);
            const end = new Date(to);
            end.setHours(0, 0, 0, 0);
            while (cur <= end) {
                const d = cur.getDay();
                if (d !== 0 && d !== 6) count++;
                cur.setDate(cur.getDate() + 1);
            }
            return count;
        };
        const sprintStart = new Date(sb.startDate);
        const sprintEnd   = new Date(sb.endDate);
        const today       = new Date();
        today.setHours(0, 0, 0, 0);
        const fallbackTotal   = countWeekdays(sprintStart, sprintEnd);
        const fallbackElapsed = today >= sprintEnd ? fallbackTotal : Math.min(fallbackTotal, countWeekdays(sprintStart, today));
        const daysTotal    = sb.daysTotal    ?? fallbackTotal;
        const daysElapsed  = sb.daysElapsed  ?? fallbackElapsed;
        const daysPending  = sb.daysPending  ?? Math.max(0, daysTotal - daysElapsed);

        // On-the-go assignment model (sprintBurndown.onTrackStatus === 'not-tracked'): report
        // the WHOLE sprint's totals, matching what the on-screen progress bar shows, not this
        // team's V2-only slice — pairing a V2-only ticket count with a team-wide completionPct
        // (as this export previously did) produces an internally inconsistent number. Falls
        // back to the V2 fields for snapshots generated before totalSprintTickets/SP existed.
        const isNotTracked = sb.onTrackStatus === 'not-tracked';
        const completedTickets = isNotTracked ? (sb.completedSprintTickets ?? sb.completedV2Tickets) : sb.completedV2Tickets;
        const totalTickets = isNotTracked ? (sb.totalSprintTickets ?? sb.totalV2Tickets) : sb.totalV2Tickets;
        const completionPct = isNotTracked ? sb.completionPct : sb.completionPct;

        const storiesPending = sb.storiesPending != null && !isNotTracked
            ? sb.storiesPending
            : Math.max(0, (totalTickets ?? 0) - (completedTickets ?? 0));
        // No ticket in the sprint is assigned to this team, so there is nothing to measure.
        // Without this guard the fallbacks below reproduce the divide-by-zero flaw for older
        // snapshots: completionPct pinned to 0 makes offTrackPct == sprintElapsedPct, which reads
        // as "critically behind" purely because the sprint clock advanced.
        const hasSprintWork = (totalTickets ?? 0) > 0;
        const offTrackPct  = (hasSprintWork && !isNotTracked)
            ? (sb.offTrackPct ?? Math.max(0, sb.sprintElapsedPct - sb.completionPct))
            : 0;
        const status = isNotTracked
            ? 'not-tracked'
            : !hasSprintWork
                ? 'on-track'
                : sb.onTrackStatus ?? (offTrackPct > 50 ? 'critical' : offTrackPct >= 30 ? 'at-risk' : 'on-track');
        const assessmentLabel =
            status === 'not-tracked' ? "NOT TRACKED — pace not scored for this team's working model" :
            !hasSprintWork            ? 'NOT EVALUATED — no sprint stories assigned to this team' :
            status === 'critical'     ? 'CRITICAL — severely behind, immediate attention required' :
            status === 'at-risk'      ? 'AT RISK — moderately behind, needs monitoring' :
                                         'ON TRACK';
        return { daysTotal, daysElapsed, daysPending, storiesPending, offTrackPct, assessmentLabel, completedTickets, totalTickets, completionPct, isNotTracked };
    }

    private formatInsightsAndNotesText(record: any, separator: string, sectionSeparator: string): string {
        let content = '';

        if (record.managerInsights && String(record.managerInsights).trim()) {
            content += `MANAGER INSIGHTS\n`;
            content += `${sectionSeparator}\n\n`;
            content += `${record.managerInsights}\n`;
            if (record.insightsHealth) {
                content += `\nAI Health Signal By Insights: ${record.insightsHealth}`;
                if (record.insightsHealthReason) {
                    content += ` — ${record.insightsHealthReason}`;
                }
                content += `\n`;
            }
            content += `\n${separator}\n\n`;
        }

        const notes = Array.isArray(record.teamNotes) ? record.teamNotes : [];
        if (notes.length > 0) {
            content += `TEAM NOTES\n`;
            content += `${sectionSeparator}\n\n`;
            for (const note of notes) {
                const author = note?.name || note?.userId || 'Unknown';
                let ts = '';
                if (note?.timestamp) {
                    try {
                        ts = new Date(note.timestamp).toLocaleString('en-US');
                    } catch {
                        ts = String(note.timestamp);
                    }
                }
                content += ts ? `[${ts}] ${author}:\n` : `${author}:\n`;
                content += `${note?.text || ''}\n\n`;
            }
            content += `${separator}\n\n`;
        }

        return content;
    }

    private insightsAndNotesCsvRows(record: any): string[][] {
        const rows: string[][] = [];

        if (record.managerInsights && String(record.managerInsights).trim()) {
            rows.push(['Manager Insights', record.managerInsights]);
        }
        if (record.originalExecutiveSummary && record.originalExecutiveSummary !== record.executiveSummary) {
            rows.push(['Original AI Summary', record.originalExecutiveSummary]);
        }
        if (record.insightsHealth) {
            const val = record.insightsHealthReason
                ? `${record.insightsHealth} — ${record.insightsHealthReason}`
                : record.insightsHealth;
            rows.push(['Insights Health Signal', val]);
        }

        const notes = Array.isArray(record.teamNotes) ? record.teamNotes : [];
        if (notes.length > 0) {
            rows.push(['']);
            rows.push(['Team Notes', '']);
            rows.push(['Author', 'Timestamp', 'Note']);
            for (const note of notes) {
                const author = note?.name || note?.userId || 'Unknown';
                let ts = '';
                if (note?.timestamp) {
                    try {
                        ts = new Date(note.timestamp).toLocaleString('en-US');
                    } catch {
                        ts = String(note.timestamp);
                    }
                }
                rows.push([author, ts, note?.text || '']);
            }
        }

        return rows;
    }

    private formatDailyReportCSV(snapshot: any, projectName: string, date: string): string {
        const sb = snapshot.sprintBurndown;
        const sprintRows: string[][] = sb ? (() => {
            const f = this.resolveSprintFields(sb);
            return [
                [''],
                [f.isNotTracked ? 'Sprint Progress (Whole Board)' : 'Sprint Progress (Team Only)', ''],
                ['Sprint Name', sb.sprintName],
                ['Sprint Period', `${sb.startDate} to ${sb.endDate}`],
                ['Days Elapsed / Total', `Day ${f.daysElapsed} of ${f.daysTotal} (${f.daysPending} days remaining)`],
                ['Stories Completed', `${f.completedTickets} of ${f.totalTickets} (${f.storiesPending} pending, ${f.completionPct}%)`],
                ['Sprint Elapsed %', `${sb.sprintElapsedPct}%`],
                ...(f.isNotTracked ? [] : [['Off-Track %', `${f.offTrackPct}%`]]),
                ['Sprint Assessment', f.assessmentLabel],
            ];
        })() : [];

        const rows: string[][] = [
            ['Project', projectName],
            ['Date', date],
            ['Board Name', snapshot.boardName || 'N/A'],
            ['Overall Health', snapshot.overallHealth || 'Unknown'],
            [''],
            ['Section', 'Content'],
            ['Executive Summary', snapshot.executiveSummary || ''],
            ['Risks & Blockers', snapshot.executiveRisks || ''],
            ['Detailed Work Summary', snapshot.workSummary || ''],
            ...(snapshot.ticketDetails ? [
                [''],
                ['Ticket-Level Details', ''],
                ...snapshot.ticketDetails.split('\n')
                    .map((l: string) => l.trim()).filter((l: string) => l)
                    .map((l: string) => {
                        const m = l.match(/^[-•*\s]*([A-Z]+-\d+):\s*(.*)/);
                        return m ? [m[1], m[2]] : ['', l.replace(/^[-•*\s]+/, '')];
                    })
            ] : []),
            ...sprintRows,
            ...this.insightsAndNotesCsvRows(snapshot),
        ];

        return rows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    }

    private formatDailyReportText(snapshot: any, projectName: string, date: string, reportWindowStr: string): string {
        const separator = '='.repeat(80);
        const sectionSeparator = '-'.repeat(80);

        const formattedDate = new Date(date).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        let content = '';

        // Header
        content += `${separator}\n`;
        content += `                    DAILY STATUS REPORT\n`;
        content += `${separator}\n\n`;
        content += `Project: ${projectName}\n`;
        content += `Date: ${formattedDate}\n`;
        content += `Board: ${snapshot.boardName || 'N/A'}\n`;
        content += `Overall Health: ${snapshot.overallHealth || 'Unknown'}\n`;
        content += `\n${separator}\n\n`;

        // Executive Summary
        content += `EXECUTIVE SUMMARY\n`;
        content += `${sectionSeparator}\n\n`;
        content += `${snapshot.executiveSummary || 'No summary available.'}\n`;
        content += `\n${separator}\n\n`;

        if (snapshot.originalExecutiveSummary && snapshot.originalExecutiveSummary !== snapshot.executiveSummary) {
            content += `ORIGINAL AI SUMMARY (pre-insights)\n`;
            content += `${sectionSeparator}\n\n`;
            content += `${snapshot.originalExecutiveSummary}\n`;
            content += `\n${separator}\n\n`;
        }

        // Sprint Progress (Scrum projects only)
        const sb = snapshot.sprintBurndown;
        if (sb) {
            const f = this.resolveSprintFields(sb);
            content += `SPRINT PROGRESS (${f.isNotTracked ? 'WHOLE BOARD' : 'TEAM ONLY'})\n`;
            content += `${sectionSeparator}\n\n`;
            content += `Sprint:      ${sb.sprintName}\n`;
            content += `Period:      ${sb.startDate} to ${sb.endDate}\n`;
            content += `Days:        Day ${f.daysElapsed} of ${f.daysTotal} (${f.daysPending} days remaining, ${sb.sprintElapsedPct}% elapsed)\n`;
            content += `Stories:     ${f.completedTickets} of ${f.totalTickets} completed (${f.storiesPending} pending, ${f.completionPct}% done)\n`;
            if (!f.isNotTracked) {
                content += `Off-track:   ${f.offTrackPct}% behind expected pace\n`;
            }
            content += `Assessment:  ${f.assessmentLabel}\n`;
            content += `\n${separator}\n\n`;
        }

        // Risks & Blockers
        content += `RISKS & BLOCKERS\n`;
        content += `${sectionSeparator}\n\n`;
        content += `${snapshot.executiveRisks || 'No risks or blockers identified.'}\n`;
        content += `\n${separator}\n\n`;

        // Detailed Work Summary
        content += `DETAILED WORK SUMMARY\n`;
        content += `${sectionSeparator}\n\n`;
        content += `${snapshot.workSummary || 'No detailed work summary available.'}\n`;
        content += `\n${separator}\n\n`;

        // Ticket-Level Details
        if (snapshot.ticketDetails) {
            content += `TICKET-LEVEL DETAILS\n`;
            content += `${sectionSeparator}\n\n`;
            content += `${snapshot.ticketDetails}\n`;
            content += `\n${separator}\n\n`;
        }

        content += this.formatInsightsAndNotesText(snapshot, separator, sectionSeparator);

        // Footer
        content += `Report generated on: ${new Date().toLocaleString('en-US')}\n`;
        content += `Report Window (IST): ${reportWindowStr}\n`;
        content += `${separator}\n`;

        return content;
    }

    // ---------------------------------------------------------------------------
    // Manager Insights Endpoints
    // ---------------------------------------------------------------------------

    /**
     * PATCH /report/daily/:id/insights
     * Save raw manager insights. Preserves original exec summary and returns AI health suggestion if warranted.
     */
    async generateMonthlyAccountReport(req: Request, res: Response): Promise<void> {
        try {
            const { accountId, month, year, force } = req.body;

            if (!accountId) {
                res.status(400).json({ error: 'accountId is required' });
                return;
            }

            logger.info(`API Request: Generate Monthly Account Report for Account ${accountId} (Force: ${force})`, 'ReportController');

            if (force === true) {
                const { monthlyAccountReportQueue } = require('../queues/monthlyAccountReportQueue');
                const opts: { jobId?: string } = {};
                if (month && year) {
                    opts.jobId = monthlyAccountJobId(accountId, month, year);
                    await monthlyAccountReportQueue.remove(opts.jobId).catch(() => undefined);
                }
                await monthlyAccountReportQueue.add('generate-monthly-account-report', {
                    accountId,
                    month,
                    year
                }, opts);

                res.status(200).json({
                    success: true,
                    message: 'Processing the request to generate Monthly Account Report. It may take up to three minutes.',
                    data: {
                        isAsync: true,
                        message: 'Processing the request to generate Monthly Account Report. It may take up to three minutes.'
                    }
                });
                return;
            }

            const { monthlyAccountReportService } = require('../services/monthlyAccountReportService');
            const report = await monthlyAccountReportService.generateMonthlyAccountReport(accountId, month, year, force);

            res.json({
                success: true,
                message: 'Monthly account report generated successfully',
                data: report
            });
        } catch (error: any) {
            console.error('Error generating monthly account report:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                details: error.message
            });
        }
    }

    async listMonthlyAccountReports(req: Request, res: Response): Promise<void> {
        try {
            const { accountId } = req.params;
            const { page = 1, limit = 10, health } = req.query;

            if (!accountId) {
                res.status(400).json({ error: 'accountId is required' });
                return;
            }

            const pageNum = parseInt(page as string, 10) || 1;
            const limitNum = parseInt(limit as string, 10) || 10;
            const offset = (pageNum - 1) * limitNum;

            const { MonthlyAccountReport } = require('../../../models/MonthlyAccountReport');

            const whereClause: any = {
                accountId: parseInt(accountId as string, 10)
            };

            if (health && health !== 'All') {
                whereClause.health = health;
            }

            const { rows: reports, count } = await MonthlyAccountReport.findAndCountAll({
                where: whereClause,
                order: [['year', 'DESC'], ['month', 'DESC']],
                limit: limitNum,
                offset
            });

            res.json({
                success: true,
                message: 'Monthly account reports fetched successfully',
                data: {
                    reports,
                    total: count,
                    page: pageNum,
                    totalPages: Math.ceil(count / limitNum)
                }
            });
        } catch (error: any) {
            console.error('Error listing monthly account reports:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                details: error.message
            });
        }
    }

    async downloadMonthlyAccountReport(req: Request, res: Response): Promise<void> {
        try {
            const { accountId, month, year } = req.query;

            if (!accountId || !month || !year) {
                res.status(400).json({ error: 'accountId, month, and year are required' });
                return;
            }

            const { MonthlyAccountReport } = require('../../../models/MonthlyAccountReport');

            const report = await MonthlyAccountReport.findOne({
                where: { accountId, month, year }
            });

            if (!report) {
                res.status(404).json({ error: 'Report file not found' });
                return;
            }

            // See downloadAccountReport — re-render a stale/missing deck from stored data.
            let filePath: string | undefined = report.filePath;
            if (!filePath || !pptGenerator.isDeckCurrent(filePath) || !fs.existsSync(filePath)) {
                const { monthlyAccountReportService } = require('../services/monthlyAccountReportService');
                filePath = await monthlyAccountReportService.renderDeckFromStored(report);
            }

            if (!filePath || !fs.existsSync(filePath)) {
                res.status(404).json({ error: 'File on disk not found' });
                return;
            }

            res.download(filePath, pptGenerator.friendlyDeckName(filePath));
        } catch (error: any) {
            console.error('Error downloading monthly account report:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                details: error.message
            });
        }
    }

    async saveDailyInsights(req: Request, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id as string);
            const { insights } = req.body;

            if (!insights || typeof insights !== 'string') {
                res.status(400).json({ error: 'insights (string) is required' });
                return;
            }

            const userId = (req as any).user?.id;
            const userName = `${(req as any).user?.firstName ?? ''} ${(req as any).user?.lastName ?? ''}`.trim();
            const isSuperuser = (req as any).user?.role === 'SUPERUSER';
            const result = await reportService.saveDailyInsights(id, insights.trim(), userId, userName, isSuperuser);
            res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error('saveDailyInsights error', error, 'ReportController');
            const statusCode = error.statusCode ?? 500;
            res.status(statusCode).json({ error: statusCode === 403 ? error.message : 'Internal Server Error', details: error.message });
        }
    }

    /**
     * PATCH /report/daily/:id/insights/health
     * Apply an AI-suggested (and manager-accepted) health escalation from insights.
     * Body: { insightsHealth: 'Amber' | 'Red', reason: string }
     */
    async applyInsightsHealth(req: Request, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id as string);
            const { insightsHealth, reason } = req.body;

            if (!insightsHealth || !['Green', 'Amber', 'Red'].includes(insightsHealth)) {
                res.status(400).json({ error: 'insightsHealth must be Green, Amber, or Red' });
                return;
            }
            if (!reason || typeof reason !== 'string') {
                res.status(400).json({ error: 'reason (string) is required' });
                return;
            }

            await reportService.applyInsightsHealth(id, insightsHealth, reason.trim());
            res.json({ success: true, message: 'Insights health applied.' });
        } catch (error: any) {
            logger.error('applyInsightsHealth error', error, 'ReportController');
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }

    /**
     * Verify user has full account access for account-level insights operations.
     * Mirrors the checkPermission middleware logic for account report generation.
     * SUPERUSER always passes. Non-SUPERUSER must have full access to the account.
     */
    private async verifyAccountInsightsAccess(req: Request, reportType: string, reportId: number): Promise<boolean> {
        const user = (req as any).user;
        if (!user) return false;
        if (user.role === 'SUPERUSER') return true;
        if (!['weekly_account', 'monthly_account'].includes(reportType)) return true;

        // Look up accountId from the report
        let accountId: number | null = null;
        if (reportType === 'weekly_account') {
            const report = await AccountWeeklyReport.findByPk(reportId, { attributes: ['accountId'] });
            if (!report) return false;
            accountId = (report as any).accountId;
        } else {
            const report = await MonthlyAccountReport.findByPk(reportId, { attributes: ['accountId'] });
            if (!report) return false;
            accountId = (report as any).accountId;
        }
        if (!accountId) return false;

        // Find the user's account-scoped permission rows. Program-owner rows also live under
        // this accountId with empty projectIds and would otherwise be misread as full access.
        // findAll rather than findOne: with no unique constraint on (userId, accountId,
        // programId), a stale duplicate row can sit next to the current one, and an unordered
        // findOne could return either — union/agree across every matching row instead of
        // trusting whichever one comes back first.
        const permissions = await UserPermission.findAll({ where: { userId: user.id, accountId, programId: null } });
        if (permissions.length === 0) return false;
        if (permissions.every(p => !p.projectIds || (p.projectIds as number[]).length === 0)) {
            return true; // Full account access, unanimous across every row
        }

        const projectIds = new Set<number>();
        for (const p of permissions) {
            for (const id of (p.projectIds as number[]) ?? []) projectIds.add(id);
        }

        // Check if the union of the user's explicit project lists covers all projects in the account
        const totalCount = await Project.count({ where: { accountId } });
        return projectIds.size >= totalCount;
    }

    /**
     * POST /report/:reportType/:id/insights/preview
     * Preview a refreshed executive summary without saving.
     * Body: { insights: string }
     * Param reportType: 'daily' | 'weekly_project' | 'weekly_account'
     */
    async previewInsights(req: Request, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id as string);
            const reportType = req.params.reportType as 'daily' | 'weekly_project' | 'weekly_account' | 'monthly_project' | 'monthly_account';
            const { insights } = req.body;

            if (!insights || typeof insights !== 'string') {
                res.status(400).json({ error: 'insights (string) is required' });
                return;
            }

            const validTypes = ['daily', 'weekly_project', 'weekly_account', 'monthly_project', 'monthly_account'];
            if (!validTypes.includes(reportType)) {
                res.status(400).json({ error: `reportType must be one of: ${validTypes.join(', ')}` });
                return;
            }

            const hasAccess = await this.verifyAccountInsightsAccess(req, reportType, id);
            if (!hasAccess) {
                res.status(403).json({ error: 'You do not have permission to edit insights for this account report.' });
                return;
            }

            const result = await reportService.previewInsights(id, insights.trim(), reportType);
            res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error('previewInsights error', error, 'ReportController');
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }

    /**
     * PATCH /report/:reportType/:id/insights/accept
     * Save accepted manager insights + new executive summary.
     * Body: { insights: string, newSummary: string }
     */
    async saveInsights(req: Request, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id as string);
            const reportType = req.params.reportType as 'daily' | 'weekly_project' | 'weekly_account' | 'monthly_project' | 'monthly_account';
            const { insights, newSummary } = req.body;

            if (!insights || typeof insights !== 'string') {
                res.status(400).json({ error: 'insights (string) is required' });
                return;
            }
            if (!newSummary || typeof newSummary !== 'string') {
                res.status(400).json({ error: 'newSummary (string) is required' });
                return;
            }

            const hasAccess = await this.verifyAccountInsightsAccess(req, reportType, id);
            if (!hasAccess) {
                res.status(403).json({ error: 'You do not have permission to edit insights for this account report.' });
                return;
            }

            const userId = (req as any).user?.id;
            const userName = `${(req as any).user?.firstName ?? ''} ${(req as any).user?.lastName ?? ''}`.trim();
            const isSuperuser = (req as any).user?.role === 'SUPERUSER';
            await reportService.saveInsights(id, insights.trim(), newSummary.trim(), reportType, userId, userName, isSuperuser);
            res.json({ success: true, message: 'Insights and executive summary saved.' });
        } catch (error: any) {
            logger.error('saveInsights error', error, 'ReportController');
            const statusCode = error.statusCode ?? 500;
            res.status(statusCode).json({ error: statusCode === 403 ? error.message : 'Internal Server Error', details: error.message });
        }
    }

    /**
     * PATCH /report/:reportType/:id/team-notes
     * Append a team note (visible to all, no AI side effects).
     * Body: { text: string }
     */
    async addTeamNote(req: Request, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id as string);
            const reportType = req.params.reportType as 'daily' | 'weekly_project' | 'weekly_account' | 'monthly_project' | 'monthly_account';
            const { text } = req.body;

            if (!text || typeof text !== 'string' || !text.trim()) {
                res.status(400).json({ error: 'text (string) is required' });
                return;
            }

            const userId = (req as any).user?.id;
            const userName = `${(req as any).user?.firstName ?? ''} ${(req as any).user?.lastName ?? ''}`.trim();
            await reportService.addTeamNote(id, reportType, userId, userName, text.trim());
            res.json({ success: true });
        } catch (error: any) {
            logger.error('addTeamNote error', error, 'ReportController');
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }
}

export const reportController = new ReportController();
