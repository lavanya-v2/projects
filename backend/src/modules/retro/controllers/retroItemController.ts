/* eslint-disable @typescript-eslint/no-explicit-any */
import { Response } from 'express';
import { retroItemService } from '../services/retroItemService';
import { retroConversionService } from '../services/retroConversionService';
import type { RetroRequest } from '../middleware/requireBoardAccess';

function fail(res: Response, error: any, fallback: string) {
    const status = error?.statusCode || 500;
    if (status >= 500) console.error(`${fallback}:`, error);
    res.status(status).json({ error: error?.message || fallback });
}

export const retroItemController = {
    async createItem(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroItemService.createItem(req.retroBoard!, req.user, req.body);
            res.status(201).json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to create retro item');
        }
    },

    async updateItem(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroItemService.updateItem(
                req.retroItem!,
                req.retroBoard!,
                req.user,
                req.body
            );
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to update retro item');
        }
    },

    async deleteItem(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroItemService.deleteItem(req.retroItem!, req.retroBoard!, req.user);
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to delete retro item');
        }
    },

    async toggleVote(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroItemService.toggleVote(req.retroItem!, req.retroBoard!, req.user);
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to record vote');
        }
    },

    async setTopPick(req: RetroRequest, res: Response): Promise<void> {
        try {
            const rank = req.body.rank === null || req.body.rank === undefined ? null : parseInt(req.body.rank);
            const data = await retroItemService.setTopPick(req.retroItem!, req.retroBoard!, req.user, rank);
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to set top pick');
        }
    },

    async listComments(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroItemService.listComments(req.retroItem!, req.retroBoard!, req.user);
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to load comments');
        }
    },

    async createComment(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroItemService.createComment(
                req.retroItem!,
                req.retroBoard!,
                req.user,
                req.body
            );
            res.status(201).json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to add comment');
        }
    },

    async updateComment(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroItemService.updateComment(
                req.retroComment!,
                req.retroItem!,
                req.retroBoard!,
                req.user,
                req.body
            );
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to update comment');
        }
    },

    async deleteComment(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroItemService.deleteComment(
                req.retroComment!,
                req.retroItem!,
                req.retroBoard!,
                req.user
            );
            res.json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to delete comment');
        }
    },

    async convertToActionItem(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroConversionService.toActionItem(
                req.retroItem!,
                req.retroBoard!,
                req.user,
                req.body,
                req.query.force === 'true'
            );
            res.status(201).json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to convert to action item');
        }
    },

    async convertToRisk(req: RetroRequest, res: Response): Promise<void> {
        try {
            const data = await retroConversionService.toRisk(
                req.retroItem!,
                req.retroBoard!,
                req.user,
                req.body,
                req.query.force === 'true'
            );
            res.status(201).json({ success: true, data });
        } catch (error) {
            fail(res, error, 'Failed to convert to risk');
        }
    },
};
