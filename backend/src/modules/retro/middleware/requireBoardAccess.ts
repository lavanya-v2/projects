/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response, NextFunction } from 'express';
import { RetroBoard } from '../../../models/RetroBoard';
import { RetroItem } from '../../../models/RetroItem';
import { RetroItemComment } from '../../../models/RetroItemComment';
import { User } from '../../../models/User';
import { Project } from '../../../models/Project';
import { getAccessibleProjectIds } from '../../../common/projectAccess';
import { isFacilitator, isBoardWritable } from '../services/retroPermissions';

export interface RetroRequest extends Request {
    user?: any;
    retroBoard?: RetroBoard;
    retroItem?: RetroItem;
    retroComment?: RetroItemComment;
    retroIsFacilitator?: boolean;
}

/**
 * - `read`        any project-team member (DRAFT stays private to the facilitator)
 * - `write`       participants adding/changing content; requires a writable board
 * - `facilitate`  facilitator identity only, deliberately still allowed on a
 *                 COMPLETED board so status changes and conversion keep working
 *                 after the meeting ends
 * - `configure`   facilitator identity AND a non-frozen board — for changes to
 *                 the board's own settings and lanes
 *
 * `configure` exists because `facilitate` checked identity alone, which let a
 * facilitator edit settings and lanes on a COMPLETED board through the API. That
 * contradicted both `canEditSettings` and the freeze the UI promises.
 */
export type BoardAccessMode = 'read' | 'write' | 'facilitate' | 'configure';

function isPrivileged(user: any): boolean {
    return user?.role === 'SUPERUSER' || user?.roleName === 'superuser' || user?.roleName === 'admin';
}

/**
 * Resolve the board this request is about, from whichever identifier the route
 * carries. Controllers then read req.retroBoard rather than re-fetching.
 */
async function resolveBoard(req: RetroRequest): Promise<RetroBoard | null> {
    const include = [
        { model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] },
        { model: Project, attributes: ['id', 'name'] },
    ];

    const boardId = req.params.boardId ?? req.body?.boardId;
    if (boardId) {
        return RetroBoard.findByPk(parseInt(boardId as string), { include });
    }

    if (req.params.token) {
        return RetroBoard.findOne({ where: { shareToken: req.params.token as string }, include });
    }

    if (req.params.itemId) {
        const item = await RetroItem.findByPk(parseInt(req.params.itemId as string));
        if (!item) return null;
        req.retroItem = item;
        return RetroBoard.findByPk(item.boardId, { include });
    }

    if (req.params.commentId) {
        const comment = await RetroItemComment.findByPk(parseInt(req.params.commentId as string));
        if (!comment) return null;
        req.retroComment = comment;
        const item = await RetroItem.findByPk(comment.itemId);
        if (!item) return null;
        req.retroItem = item;
        return RetroBoard.findByPk(item.boardId, { include });
    }

    return null;
}

/**
 * The board access gate.
 *
 * Access is "project team only": any authenticated user whose UserPermission
 * rows reach the board's project may participate. The share token is not a
 * credential and is never consulted here — opening the link still puts you
 * through this check.
 *
 * Uses getAccessibleProjectIds from common/projectAccess rather than the risks
 * module's resolvePermittedProjectIds: the latter ignores programId and treats a
 * program-scoped permission row as full-account access, which would over-grant.
 */
export const requireBoardAccess =
    (mode: BoardAccessMode) =>
    async (req: RetroRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const board = await resolveBoard(req);
            if (!board) {
                res.status(404).json({ error: 'Retro board not found' });
                return;
            }

            req.retroBoard = board;
            const facilitator = isFacilitator(
                { id: req.user.id, roleName: req.user.roleName },
                board
            );
            req.retroIsFacilitator = facilitator;

            // Project-scope check. Superuser/admin bypass, as everywhere else.
            if (!isPrivileged(req.user)) {
                const accessible = await getAccessibleProjectIds(req.user.id);
                if (!accessible.has(board.projectId)) {
                    res.status(403).json({ error: 'Access denied: this project is not in your scope' });
                    return;
                }

                // A DRAFT board is the facilitator's private setup space — it is
                // not yet shared with the team, so it must not be readable by
                // them either.
                if (board.status === 'DRAFT' && !facilitator) {
                    res.status(403).json({ error: 'This retro board has not been opened yet' });
                    return;
                }
            }

            if ((mode === 'facilitate' || mode === 'configure') && !facilitator) {
                res.status(403).json({ error: 'Only the retro facilitator can do this' });
                return;
            }

            // Settings and lanes are part of the record, so they freeze with it.
            // Status transitions and conversion stay on 'facilitate' and remain
            // available after completion by design.
            if (mode === 'configure' && (board.status === 'COMPLETED' || board.status === 'ARCHIVED')) {
                res.status(409).json({
                    error: 'This retro is complete — its setup can no longer be changed',
                });
                return;
            }

            if (mode === 'write' && !isBoardWritable(board, facilitator)) {
                res.status(409).json({
                    error:
                        board.status === 'DRAFT'
                            ? 'This retro board has not been opened yet'
                            : 'This retro board is closed — its record can no longer be changed',
                });
                return;
            }

            next();
        } catch (error: any) {
            console.error('requireBoardAccess error:', error);
            res.status(500).json({ error: 'Failed to resolve retro board access' });
        }
    };
