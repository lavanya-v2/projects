/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { ReviewCycleConfig } from '../../../models/ReviewCycleConfig';
import { Project } from '../../../models/Project';
import { ReviewProjectSettings } from '../../../models/ReviewProjectSettings';
import { CompetencyTemplate } from '../../../models/CompetencyTemplate';
import { previewCycles, generateCycles, generateCatchUpCycle } from '../services/cycleGenerationService';
import { getCoverage } from '../services/identityResolutionService';
import { getEligibleReviewersForProject } from '../services/reviewCycleService';
import { getProjectDataHealthBatch } from '../services/dataHealthService';

interface AuthRequest extends Request {
    user?: any;
}

const CADENCES = ['monthly', 'quarterly'];

function parseId(raw: unknown): number | null {
    const id = parseInt(raw as string);
    return Number.isFinite(id) && id > 0 ? id : null;
}

export const reviewConfigController = {
    /** Config plus per-project rollout readiness for the whole account. */
    async get(req: AuthRequest, res: Response) {
        const accountId = parseId(req.params.accountId);
        if (!accountId) return res.status(400).json({ message: 'Invalid accountId' });

        try {
            const config = await ReviewCycleConfig.findOne({ where: { accountId } });
            const projects = await Project.findAll({
                where: { accountId },
                attributes: ['id', 'name', 'dataSourceType', 'isKanbanProject', 'isActive'],
                order: [['name', 'ASC']],
            });

            // Identity resolution state per project is informational only — it
            // drives the ready/not-ready styling in the rollout picker, but does
            // not block a project from being added to scope. See Phase 8.
            const inScope = new Set(config?.scopeProjectIds ?? []);
            const healthByProject = await getProjectDataHealthBatch(
                projects.map(p => p.id),
                config?.cadence ?? 'monthly',
            );
            const rollout = [];
            for (const p of projects) {
                const coverage = await getCoverage(p.id);
                rollout.push({
                    projectId: p.id,
                    name: (p as any).name,
                    dataSourceType: (p as any).dataSourceType ?? 'jira',
                    isActive: (p as any).isActive,
                    inScope: inScope.has(p.id),
                    gate: {
                        ready: coverage.undecidedKeyCount === 0 && coverage.linkedPct === 100,
                        undecidedKeyCount: coverage.undecidedKeyCount,
                        linkedPct: coverage.linkedPct,
                        totalScoreRows: coverage.totalScoreRows,
                    },
                    dataHealth: healthByProject.get(p.id) ?? null,
                });
            }

            return res.json({ config, rollout });
        } catch (error) {
            console.error('[reviewConfig] get failed:', error);
            return res.status(500).json({ message: 'Failed to load review configuration' });
        }
    },

    /** Create or update the account's config, including the project rollout list. */
    async upsert(req: AuthRequest, res: Response) {
        const accountId = parseId(req.params.accountId);
        if (!accountId) return res.status(400).json({ message: 'Invalid accountId' });

        const body = req.body ?? {};
        const weights = {
            weightSystem: Number(body.weightSystem ?? 60),
            weightLead: Number(body.weightLead ?? 40),
            weightCustomer: Number(body.weightCustomer ?? 0),
        };
        const sum = weights.weightSystem + weights.weightLead + weights.weightCustomer;
        if (Math.abs(sum - 100) > 0.001) {
            return res.status(400).json({ message: `Weights must total 100 (got ${sum})` });
        }
        if (body.cadence && !CADENCES.includes(body.cadence)) {
            return res.status(400).json({ message: `cadence must be one of ${CADENCES.join(', ')}` });
        }
        if (body.anchorDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.anchorDate))) {
            return res.status(400).json({ message: 'anchorDate must be YYYY-MM-DD' });
        }

        const scopeProjectIds: number[] = Array.isArray(body.scopeProjectIds)
            ? [...new Set<number>(body.scopeProjectIds.map((n: any) => parseInt(n)).filter((n: number) => Number.isFinite(n)))]
            : [];

        try {
            const existing = await ReviewCycleConfig.findOne({ where: { accountId } });

            // A project may be added to scope regardless of identity resolution
            // state — only resolved people are ever scored, so an unresolved
            // straggler is simply absent from a cycle until confirmed, never a
            // reason to hold the rest of the team hostage. See getCoverage() for
            // the informational (not blocking) resolved/unresolved counts.

            // Projects must belong to this account — scope is not a way to reach
            // across accounts.
            if (scopeProjectIds.length > 0) {
                const owned = await Project.count({
                    where: { id: { [Op.in]: scopeProjectIds }, accountId },
                });
                if (owned !== scopeProjectIds.length) {
                    return res.status(400).json({ message: 'All scope projects must belong to this account' });
                }
            }

            const values = {
                accountId,
                scopeProjectIds,
                cadence: body.cadence ?? existing?.cadence ?? 'monthly',
                anchorDate: body.anchorDate ?? existing?.anchorDate,
                timezone: body.timezone ?? existing?.timezone ?? 'Asia/Kolkata',
                reviewYearStartMonth: Number(body.reviewYearStartMonth ?? existing?.reviewYearStartMonth ?? 4),
                ...weights,
                leadTemplateId: body.leadTemplateId ?? existing?.leadTemplateId ?? null,
                isEnabled: body.isEnabled ?? existing?.isEnabled ?? false,
                createdByUserId: existing?.createdByUserId ?? req.user!.id,
            };

            if (!values.anchorDate) {
                return res.status(400).json({ message: 'anchorDate is required' });
            }

            // setupDate is set once, at first creation, and never touched again —
            // it's the honest "when did this account start" fact, which
            // re-saving config (even just flipping isEnabled) must not move.
            const config = existing
                ? await existing.update(values)
                : await ReviewCycleConfig.create({ ...values, setupDate: new Date().toISOString().slice(0, 10) } as any);

            return res.json(config);
        } catch (error) {
            console.error('[reviewConfig] upsert failed:', error);
            return res.status(500).json({ message: 'Failed to save review configuration' });
        }
    },

    /** Dry-run the cadence. No writes — lets the admin see boundaries first. */
    async preview(req: AuthRequest, res: Response) {
        const accountId = parseId(req.params.accountId);
        if (!accountId) return res.status(400).json({ message: 'Invalid accountId' });

        const { from, to } = req.query as Record<string, string>;
        if (!from || !to) return res.status(400).json({ message: 'from and to are required' });

        try {
            return res.json(await previewCycles(accountId, from, to));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to preview cycles';
            return res.status(message.includes('No review configuration') ? 404 : 500).json({ message });
        }
    },

    /** Materialise cycles. Idempotent; backfills the review year by default. */
    async generate(req: AuthRequest, res: Response) {
        const accountId = parseId(req.body?.accountId);
        if (!accountId) return res.status(400).json({ message: 'accountId is required' });

        const upTo = String(req.body?.upTo || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(upTo)) {
            return res.status(400).json({ message: 'upTo must be YYYY-MM-DD' });
        }

        try {
            const result = await generateCycles(accountId, upTo, req.body?.from);
            return res.json(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to generate cycles';
            return res.status(message.includes('No review configuration') ? 404 : 500).json({ message });
        }
    },

    /**
     * A one-off period covering several skipped pre-setup months, superuser
     * only. Never a replacement for the normal cadence — it's how the months
     * hidden by Phase 12c's forward-only default still get collected feedback,
     * once, rather than being silently dropped.
     */
    async generateCatchUp(req: AuthRequest, res: Response) {
        const accountId = parseId(req.body?.accountId);
        if (!accountId) return res.status(400).json({ message: 'accountId is required' });

        const startDate = String(req.body?.startDate || '').trim();
        const endDate = String(req.body?.endDate || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
            return res.status(400).json({ message: 'startDate and endDate must be YYYY-MM-DD' });
        }

        try {
            const cycle = await generateCatchUpCycle(accountId, startDate, endDate);
            return res.status(201).json(cycle);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to create the catch-up period';
            return res.status(message.includes('No review configuration') ? 404 : 400).json({ message });
        }
    },

    /** This project's setup overrides — template, default reviewer, and who's eligible to be one. */
    async getProjectSettings(req: AuthRequest, res: Response) {
        const projectId = parseId(req.params.projectId);
        if (!projectId) return res.status(400).json({ message: 'Invalid projectId' });

        try {
            const project = await Project.findByPk(projectId, { attributes: ['id'] });
            if (!project) return res.status(404).json({ message: 'Project not found' });

            const [settings, eligibleReviewers] = await Promise.all([
                ReviewProjectSettings.findOne({ where: { projectId } }),
                getEligibleReviewersForProject(projectId),
            ]);
            return res.json({
                projectId,
                templateId: settings?.templateId ?? null,
                defaultReviewerUserId: settings?.defaultReviewerUserId ?? null,
                eligibleReviewers,
            });
        } catch (error) {
            console.error('[reviewConfig] getProjectSettings failed:', error);
            return res.status(500).json({ message: 'Failed to load project settings' });
        }
    },

    /** Point this project at a specific competency template and/or default reviewer, or clear either. */
    async updateProjectSettings(req: AuthRequest, res: Response) {
        const projectId = parseId(req.params.projectId);
        if (!projectId) return res.status(400).json({ message: 'Invalid projectId' });

        const rawTemplateId = req.body?.templateId;
        const templateId = rawTemplateId === null || rawTemplateId === undefined ? null : parseId(rawTemplateId);
        if (rawTemplateId !== null && rawTemplateId !== undefined && !templateId) {
            return res.status(400).json({ message: 'templateId must be a positive integer or null' });
        }

        const hasReviewerField = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'defaultReviewerUserId');
        const rawReviewerId = req.body?.defaultReviewerUserId;
        const defaultReviewerUserId = rawReviewerId === null || rawReviewerId === undefined ? null : parseId(rawReviewerId);
        if (rawReviewerId !== null && rawReviewerId !== undefined && !defaultReviewerUserId) {
            return res.status(400).json({ message: 'defaultReviewerUserId must be a positive integer or null' });
        }

        try {
            const project = await Project.findByPk(projectId, { attributes: ['id'] });
            if (!project) return res.status(404).json({ message: 'Project not found' });

            if (templateId) {
                const template = await CompetencyTemplate.findOne({ where: { id: templateId, status: 'active' } });
                if (!template) return res.status(400).json({ message: 'Template not found or not active' });
            }

            if (defaultReviewerUserId) {
                const eligible = await getEligibleReviewersForProject(projectId);
                if (!eligible.some(r => r.id === defaultReviewerUserId)) {
                    return res.status(400).json({ message: 'defaultReviewerUserId is not eligible to review this project' });
                }
            }

            const [settings] = await ReviewProjectSettings.findOrCreate({
                where: { projectId },
                defaults: { projectId, templateId, defaultReviewerUserId },
            });
            const updates: Record<string, unknown> = {};
            if (settings.templateId !== templateId) updates.templateId = templateId;
            if (hasReviewerField && settings.defaultReviewerUserId !== defaultReviewerUserId) {
                updates.defaultReviewerUserId = defaultReviewerUserId;
            }
            if (Object.keys(updates).length > 0) {
                await settings.update(updates);
            }

            return res.json({
                projectId,
                templateId: settings.templateId,
                defaultReviewerUserId: settings.defaultReviewerUserId,
            });
        } catch (error) {
            console.error('[reviewConfig] updateProjectSettings failed:', error);
            return res.status(500).json({ message: 'Failed to save project settings' });
        }
    },
};
