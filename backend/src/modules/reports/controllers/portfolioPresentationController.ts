import { Request, Response } from 'express';
import { portfolioPresentationService } from '../services/portfolioPresentationService';
import { getAccessibleProjectIds } from '../../../common/projectAccess';

class PortfolioPresentationController {

    async listByAccount(req: Request, res: Response): Promise<void> {
        try {
            const projectId = (req.query.projectId as number | 'all' );
            const searchParams = (req.query.searchParams || req.query.search || '') as string;
            const accountId = parseInt(req.params.accountId as string);
            const sortBy = String(req.query.sortBy);
            const sortOrder = String(req.query.sortOrder);
            const pageNumber = Number(req.query.pageNumber) || 1;
            const pageLimit = Number(req.query.pageLimit) || 10;
            const portfolioItems = await portfolioPresentationService.listByAccount(req, accountId, pageNumber, pageLimit, projectId, searchParams, sortBy, sortOrder);

            res.json({ success: true, data: portfolioItems.rows, totalItems: portfolioItems.count });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    }

    async previewPayload(req: Request, res: Response): Promise<void> {
        try {
            const accountId = parseInt(req.params.accountId as string);
            const payload = await portfolioPresentationService.previewPayload(accountId, req.body);
            res.json({ success: true, data: payload });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    }

    async createPresentation(req: Request, res: Response): Promise<void> {
        try {
            const accountId = parseInt(req.params.accountId as string);
            const userId = (req as any).user?.id ?? null;
            const role = (req as any).user?.role;
            const roleName = (req as any).user?.roleName;

            // For non-superuser/non-admin: the caller must have access to at least
            // one of the selected projects. (The account gate is handled by route
            // middleware; this guards against widening the project set beyond
            // their scope at create time.)
            if (role !== 'SUPERUSER' && roleName !== 'admin' && userId) {
                const selected: number[] = Array.isArray(req.body?.selectedProjectIds) ? req.body.selectedProjectIds : [];
                if (selected.length > 0) {
                    const accessible = await getAccessibleProjectIds(userId);
                    const overlap = selected.some(pid => accessible.has(pid));
                    if (!overlap) {
                        res.status(403).json({ error: 'Access denied: none of the selected projects are in your scope' });
                        return;
                    }
                }
            }

            const row = await portfolioPresentationService.createPresentation(accountId, req.body, userId);
            res.status(201).json({ success: true, data: row });
        } catch (e: any) {
            if (e?.status === 400) {
                res.status(400).json({ error: e.message });
                return;
            }
            res.status(500).json({ error: e.message });
        }
    }

    async duplicatePresentation(req: Request, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id as string);
            const userId = (req as any).user?.id ?? null;
            const role = (req as any).user?.role;
            const roleName = (req as any).user?.roleName;

            // Copy creates a brand-new presentation, so it must require the SAME role as
            // create: superuser/admin always, otherwise only manager/lead. The route's
            // requirePortfolioPresentationAccess('write') already enforces project-scope
            // overlap (the source's projects, which become the copy's projects) — this
            // adds the role gate so plain members can read/copy-view but not create copies.
            if (role !== 'SUPERUSER' && roleName !== 'admin' && roleName !== 'manager' && roleName !== 'lead') {
                res.status(403).json({ error: 'Access denied: only managers and leads can create presentations' });
                return;
            }

            const row = await portfolioPresentationService.duplicatePresentation(id, userId);
            if (!row) {
                res.status(404).json({ error: 'Presentation not found' });
                return;
            }
            res.status(201).json({ success: true, data: row });
        } catch (e: any) {
            if (e?.status === 400) {
                res.status(400).json({ error: e.message });
                return;
            }
            res.status(500).json({ error: e.message });
        }
    }

    async getPresentation(req: Request, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id as string);
            const row = await portfolioPresentationService.getPresentation(id);
            if (!row) {
                res.status(404).json({ error: 'Presentation not found' });
                return;
            }
            res.json({ success: true, data: row });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    }

    async updatePresentation(req: Request, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id as string);
            const userId = (req as any).user?.id;
            const role = (req as any).user?.role;
            const roleName = (req as any).user?.roleName;

            // If the caller is changing the selected project list, validate they
            // still have access to ≥1 project in the proposed set. (Superuser/
            // admin bypass.) The route middleware already verified access to the
            // *existing* row's projects.
            if (role !== 'SUPERUSER' && roleName !== 'admin' && userId
                && Array.isArray(req.body?.selectedProjectIds)) {
                const selected: number[] = req.body.selectedProjectIds;
                if (selected.length > 0) {
                    const accessible = await getAccessibleProjectIds(userId);
                    const overlap = selected.some(pid => accessible.has(pid));
                    if (!overlap) {
                        res.status(403).json({ error: 'Access denied: proposed project set is outside your scope' });
                        return;
                    }
                }
            }

            const row = await portfolioPresentationService.updatePresentation(id, req.body);
            if (!row) {
                res.status(404).json({ error: 'Presentation not found' });
                return;
            }
            res.json({ success: true, data: row });
        } catch (e: any) {
            if (e.status === 403) {
                res.status(403).json({ error: e.message });
                return;
            }
            if (e.status === 400) {
                res.status(400).json({ error: e.message });
                return;
            }
            res.status(500).json({ error: e.message });
        }
    }

    async refreshFromSystem(req: Request, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id as string);
            const row = await portfolioPresentationService.refreshFromSystem(id);
            if (!row) {
                res.status(404).json({ error: 'Presentation not found' });
                return;
            }
            res.json({ success: true, data: row });
        } catch (e: any) {
            if (e.status === 403) {
                res.status(403).json({ error: e.message });
                return;
            }
            res.status(500).json({ error: e.message });
        }
    }

    async generateMOM(req: Request, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id as string);
            const { transcript, useAI, includeNotes } = req.body;
            const row = await portfolioPresentationService.generateMOM(id, {
                transcript: transcript || '',
                useAI: !!useAI,
                includeNotes: !!includeNotes,
            });
            if (!row) {
                res.status(404).json({ error: 'Presentation not found' });
                return;
            }
            res.json({ success: true, data: row });
        } catch (e: any) {
            res.status(e.status || 500).json({ error: e.message });
        }
    }

    async saveMOM(req: Request, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id as string);
            const { momContent } = req.body;
            const row = await portfolioPresentationService.saveMOMDraft(id, momContent || '');
            if (!row) {
                res.status(404).json({ error: 'Presentation not found' });
                return;
            }
            res.json({ success: true, data: row });
        } catch (e: any) {
            res.status(e.status || 500).json({ error: e.message });
        }
    }

    async acceptMOM(req: Request, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id as string);
            const userId = (req as any).user?.id ?? null;
            const { momContent } = req.body;
            const row = await portfolioPresentationService.acceptMOM(id, userId, momContent);
            if (!row) {
                res.status(404).json({ error: 'Presentation not found' });
                return;
            }
            res.json({ success: true, data: row });
        } catch (e: any) {
            res.status(e.status || 500).json({ error: e.message });
        }
    }

    async deletePresentation(req: Request, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id as string);
            const deleted = await portfolioPresentationService.deletePresentation(id);
            if (!deleted) {
                res.status(404).json({ error: 'Presentation not found' });
                return;
            }
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    }
}

export const portfolioPresentationController = new PortfolioPresentationController();
