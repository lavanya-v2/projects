/* eslint-disable @typescript-eslint/no-explicit-any */
import { Response } from 'express';
import { retroBoardService } from '../services/retroBoardService';
import { retroCarryForward } from '../services/retroCarryForward';
import type { RetroRequest } from '../middleware/requireBoardAccess';

function fail(res: Response, error: any, fallback: string) {
    const status = error?.statusCode || 500;
    if (status >= 500) console.error(`${fallback}:`, error);
    res.status(status).json({ error: error?.message || fallback });
}

export const retroBoardController = {
    async listBoards(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroBoardService.listBoards(req.user, {
                projectId: req.query.projectId ? parseInt(req.query.projectId as string) : undefined,
                status: req.query.status as string | undefined,
            });
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to list retro boards');
        }
    },

    async createBoard(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroBoardService.createBoard(req.user, req.body);
            res.status(201).json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to create retro board');
        }
    },

    async getBoard(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroBoardService.getBoardDetail(req.retroBoard!, req.user);
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to load retro board');
        }
    },

    async updateBoard(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroBoardService.updateBoard(req.retroBoard!, req.user, req.body);
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to update retro board');
        }
    },

    async updateLanes(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroBoardService.updateLanes(
                req.retroBoard!,
                req.user,
                req.body.lanes,
                req.body.reassign
            );
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to update lanes');
        }
    },

    async changeStatus(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroBoardService.changeStatus(req.retroBoard!, req.user, req.body.status);
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to change board status');
        }
    },

    async joinBoard(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroBoardService.joinBoard(req.retroBoard!, req.user);
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to join retro board');
        }
    },

    async getSummary(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroBoardService.getSummary(req.retroBoard!, req.user);
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to build retro summary');
        }
    },

    async archiveBoard(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroBoardService.archiveBoard(req.retroBoard!, req.user);
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to archive retro board');
        }
    },

    async getCarryForward(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroCarryForward.getCarryForward(req.retroBoard!, req.user);
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to load the previous retro');
        }
    },

    async setOutcome(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroCarryForward.setOutcome(
                req.retroBoard!,
                parseInt(req.params.itemId as string),
                req.user,
                req.body.outcome,
                req.body.note
            );
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to record the outcome');
        }
    },

    async getAgreedPointsHistory(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroCarryForward.getAgreedPointsHistory(
                parseInt(req.params.projectId as string),
                req.user
            );
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to load agreed points history');
        }
    },

    async convertCarriedPoint(req: RetroRequest, res: Response): Promise<void> {
        try {
            const target = req.params.target === 'risk' ? 'RISK' : 'ACTION_ITEM';
            const data = await retroCarryForward.convertCarriedPoint(
                req.retroBoard!,
                parseInt(req.params.itemId as string),
                req.user,
                target,
                req.body
            );
            res.status(201).json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to convert the agreed point');
        }
    },
};
