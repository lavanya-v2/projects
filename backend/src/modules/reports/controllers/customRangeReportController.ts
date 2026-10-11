import { Request, Response } from 'express';
import { Project } from '../../../models/Project';
import { getAccessibleProjectIds } from '../../../common/projectAccess';
import { logger } from '../../../common/utils';
import {
    CustomRangeError,
    buildCustomRangeReport,
    reportFileBase,
    renderEml,
    renderText,
    validateWindow,
    MAX_RANGE_DAYS,
} from '../services/customRangeReportService';

const isPrivileged = (user: any): boolean => user?.role === 'SUPERUSER' || user?.roleName === 'admin' || user?.roleName === 'superuser';

export class CustomRangeReportController {
    private handleError(res: Response, err: unknown, ctx: string): void {
        if (err instanceof CustomRangeError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        logger.error(`${ctx} failed: ${(err as any)?.message || err}`, 'CustomRangeReportController');
        res.status(500).json({ error: 'Failed to generate custom range report' });
    }

    /** Projects the caller may pull a custom range report for (assignment based). */
    async listProjects(req: Request, res: Response): Promise<void> {
        try {
            const user = (req as any).user;
            const where: any = { isActive: true };
            const accountId = Number(req.query.accountId);
            if (accountId) where.accountId = accountId;
            if (!isPrivileged(user)) {
                const accessible = await getAccessibleProjectIds(user.id);
                if (accessible.size === 0) {
                    res.json({ success: true, data: { maxDays: MAX_RANGE_DAYS, projects: [] } });
                    return;
                }
                where.id = Array.from(accessible);
            }
            const projects = await Project.findAll({
                where,
                attributes: ['id', 'name', 'code', 'accountId'],
                include: [{ association: 'account', attributes: ['id', 'name'] }],
                order: [['name', 'ASC']],
            });
            res.json({
                success: true,
                data: {
                    maxDays: MAX_RANGE_DAYS,
                    projects: projects.map((p: any) => ({
                        id: p.id,
                        name: p.name,
                        code: p.code,
                        accountId: p.accountId,
                        accountName: p.account?.name ?? null,
                    })),
                },
            });
        } catch (err) {
            this.handleError(res, err, 'listProjects');
        }
    }

    private async load(req: Request, source: 'body' | 'query') {
        const user = (req as any).user;
        const input = (source === 'body' ? req.body : req.query) || {};
        const projectId = Number(input.projectId);
        if (!projectId) throw new CustomRangeError(400, 'projectId is required');
        const window = validateWindow(input.startDate, input.endDate);
        const project = await Project.findByPk(projectId);
        if (!project) throw new CustomRangeError(404, 'Project not found');
        const report = await buildCustomRangeReport(project, window, user?.id);
        return { report, user };
    }

    async generate(req: Request, res: Response): Promise<void> {
        try {
            const { report } = await this.load(req, 'body');
            res.json({ success: true, data: report });
        } catch (err) {
            this.handleError(res, err, 'generate');
        }
    }

    async download(req: Request, res: Response): Promise<void> {
        try {
            const format = String(req.query.format || '').toLowerCase();
            if (format !== 'txt' && format !== 'eml') {
                throw new CustomRangeError(400, 'format must be txt or eml');
            }
            const { report, user } = await this.load(req, 'query');
            const base = reportFileBase(report);
            if (format === 'txt') {
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="${base}.txt"`);
                res.send(renderText(report));
            } else {
                res.setHeader('Content-Type', 'message/rfc822');
                res.setHeader('Content-Disposition', `attachment; filename="${base}.eml"`);
                res.send(renderEml(report, user?.email || ''));
            }
        } catch (err) {
            this.handleError(res, err, 'download');
        }
    }
}

export const customRangeReportController = new CustomRangeReportController();
