/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import * as historyService from '../services/teamMemberHistoryService';

interface AuthRequest extends Request {
    user?: any;
}

const parseId = (raw: unknown): number | null => {
    const id = parseInt(raw as string);
    return Number.isFinite(id) && id > 0 ? id : null;
};

const roleOf = (user: any): string =>
    user?.roleName ?? (user?.role === 'SUPERUSER' ? 'superuser' : 'member');

export const teamMemberHistoryController = {
    /**
     * A team member's full history — authorized against whoever is currently
     * assigned to review them, redacted for anything authored by someone else.
     */
    async get(req: AuthRequest, res: Response) {
        const teamMemberId = parseId(req.params.teamMemberId);
        if (!teamMemberId) return res.status(400).json({ message: 'Invalid teamMemberId' });

        try {
            const history = await historyService.getTeamMemberHistory(teamMemberId, {
                id: req.user!.id,
                roleName: roleOf(req.user),
            });
            return res.json(history);
        } catch (error) {
            if (error instanceof historyService.TeamMemberHistoryForbiddenError) {
                return res.status(403).json({ message: error.message });
            }
            if (error instanceof historyService.TeamMemberNotFoundError) {
                return res.status(404).json({ message: error.message });
            }
            console.error('[teamMemberHistory] get failed:', error);
            return res.status(500).json({ message: 'Failed to load team member history' });
        }
    },
};
