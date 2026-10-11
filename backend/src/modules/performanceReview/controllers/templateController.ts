/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import * as templateService from '../services/templateService';

interface AuthRequest extends Request {
    user?: any;
}

const parseId = (raw: unknown): number | null => {
    const id = parseInt(raw as string);
    return Number.isFinite(id) && id > 0 ? id : null;
};

const VALID_STATUSES = ['draft', 'active', 'retired'];

function handleError(res: Response, error: unknown, fallback: string) {
    if (error instanceof templateService.TemplateInUseError) {
        return res.status(409).json({ message: error.message });
    }
    const message = error instanceof Error ? error.message : fallback;
    if (/not found/i.test(message)) return res.status(404).json({ message });
    if (/needs|cannot|must|negative|Cannot activate/i.test(message)) {
        return res.status(400).json({ message });
    }
    console.error(`[template] ${fallback}:`, error);
    return res.status(500).json({ message: fallback });
}

export const templateController = {
    /** Templates visible to an account, with how many reviews each has been used by. */
    async list(req: AuthRequest, res: Response) {
        try {
            const accountId = parseId(req.query.accountId);
            const templates = await templateService.listTemplates(accountId ?? undefined);

            const withUsage = await Promise.all(
                templates.map(async t => ({
                    ...t.toJSON(),
                    // Drives whether the editor offers Edit or New Version.
                    usageCount: await templateService.usageCount(t.id),
                })),
            );
            return res.json(withUsage);
        } catch (error) {
            return handleError(res, error, 'Failed to list templates');
        }
    },

    async get(req: AuthRequest, res: Response) {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ message: 'Invalid template id' });

        try {
            const template = await templateService.getTemplate(id);
            if (!template) return res.status(404).json({ message: 'Template not found' });
            return res.json({
                ...template.toJSON(),
                usageCount: await templateService.usageCount(id),
            });
        } catch (error) {
            return handleError(res, error, 'Failed to load the template');
        }
    },

    async create(req: AuthRequest, res: Response) {
        try {
            const body = req.body ?? {};
            if (!String(body.name ?? '').trim()) {
                return res.status(400).json({ message: 'A template needs a name' });
            }
            const template = await templateService.createTemplate(
                { ...body, items: body.items ?? [] },
                req.user!.id,
            );
            return res.status(201).json(template);
        } catch (error) {
            return handleError(res, error, 'Failed to create the template');
        }
    },

    async update(req: AuthRequest, res: Response) {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ message: 'Invalid template id' });

        try {
            return res.json(await templateService.updateTemplate(id, req.body ?? {}));
        } catch (error) {
            return handleError(res, error, 'Failed to update the template');
        }
    },

    /** The only way to change a template that has already been answered. */
    async version(req: AuthRequest, res: Response) {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ message: 'Invalid template id' });

        try {
            return res.status(201).json(await templateService.createVersion(id, req.user!.id));
        } catch (error) {
            return handleError(res, error, 'Failed to version the template');
        }
    },

    async setStatus(req: AuthRequest, res: Response) {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ message: 'Invalid template id' });

        const status = req.body?.status;
        if (!VALID_STATUSES.includes(status)) {
            return res.status(400).json({ message: `status must be one of ${VALID_STATUSES.join(', ')}` });
        }

        try {
            return res.json(await templateService.setStatus(id, status));
        } catch (error) {
            return handleError(res, error, 'Failed to change the template status');
        }
    },
};
