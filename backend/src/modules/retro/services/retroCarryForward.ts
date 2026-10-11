/* eslint-disable @typescript-eslint/no-explicit-any */
import { Op } from 'sequelize';
import { RetroBoard } from '../../../models/RetroBoard';
import { RetroItem, type RetroOutcome } from '../../../models/RetroItem';
import { User } from '../../../models/User';
import { ProjectActionItem } from '../../../models/ProjectActionItem';
import { Risk } from '../../../models/Risk';
import { getAccessibleProjectIds } from '../../../common/projectAccess';
import { canSetOutcome } from './retroPermissions';
import { groupIntoThemes, type AgreedPointInput, type AgreedTheme } from './agreedPointsRepeat';
import { HttpError } from './retroBoardService';

/**
 * Carrying commitments forward between retros.
 *
 * Without this, an agreed point lives only inside the board that produced it and
 * disappears the moment that board is completed — so a team can agree the same
 * thing repeatedly and never notice. Every retro should open by reviewing the
 * last one.
 */

const VALID_OUTCOMES: RetroOutcome[] = ['DONE', 'STILL_OPEN', 'DROPPED'];

export interface LinkedWorkStatus {
    type: 'ACTION_ITEM' | 'RISK';
    refId: number;
    status: string | null;
    title: string | null;
}

/**
 * Read the CURRENT status of whatever an agreed point was converted into.
 *
 * Read live rather than snapshotted at conversion time: the whole point of
 * carrying a commitment forward is to show where it actually stands now, and a
 * stale copy would quietly mislead the room during the meeting.
 */
async function loadLinkedStatus(items: RetroItem[]): Promise<Map<number, LinkedWorkStatus>> {
    const byItem = new Map<number, LinkedWorkStatus>();

    const actionIds = items.filter(i => i.convertedType === 'ACTION_ITEM' && i.convertedRefId).map(i => i.convertedRefId as number);
    const riskIds = items.filter(i => i.convertedType === 'RISK' && i.convertedRefId).map(i => i.convertedRefId as number);

    const [actions, risks] = await Promise.all([
        actionIds.length
            ? ProjectActionItem.findAll({ where: { id: { [Op.in]: actionIds } }, attributes: ['id', 'status', 'title'] })
            : Promise.resolve([]),
        riskIds.length
            ? Risk.findAll({ where: { id: { [Op.in]: riskIds } }, attributes: ['id', 'status', 'title'] })
            : Promise.resolve([]),
    ]);

    const actionById = new Map(actions.map((a: any) => [a.id, a]));
    const riskById = new Map(risks.map((r: any) => [r.id, r]));

    for (const item of items) {
        if (!item.convertedType || !item.convertedRefId) continue;

        if (item.convertedType === 'ACTION_ITEM') {
            const a = actionById.get(item.convertedRefId);
            byItem.set(item.id, {
                type: 'ACTION_ITEM',
                refId: item.convertedRefId,
                // Null when the linked record was deleted — the UI says
                // "no longer available" rather than implying it is still open.
                status: a?.status ?? null,
                title: a?.title ?? null,
            });
        } else {
            const r = riskById.get(item.convertedRefId);
            byItem.set(item.id, {
                type: 'RISK',
                refId: item.convertedRefId,
                status: r?.status ?? null,
                title: r?.title ?? null,
            });
        }
    }

    return byItem;
}

export const retroCarryForward = {
    /**
     * The previous retro's agreed points, for the board currently being run.
     *
     * "Previous" is the most recent COMPLETED board on the same project that
     * met before this one — ordered by meeting date then id, so two retros on
     * the same day still resolve deterministically. Uses the existing
     * (project_id, meeting_date) index.
     */
    async getCarryForward(board: RetroBoard, user: any) {
        const previous = await RetroBoard.findOne({
            where: {
                projectId: board.projectId,
                status: 'COMPLETED',
                id: { [Op.ne]: board.id },
                [Op.or]: [
                    { meetingDate: { [Op.lt]: board.meetingDate } },
                    { meetingDate: board.meetingDate, id: { [Op.lt]: board.id } },
                ],
            },
            include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] }],
            order: [['meetingDate', 'DESC'], ['id', 'DESC']],
        });

        if (!previous) return { previousBoard: null, points: [] };

        const items = await RetroItem.findAll({
            where: { boardId: previous.id, topPickRank: { [Op.ne]: null as any } },
            include: [{ model: User, as: 'outcomeBy', attributes: ['id', 'firstName', 'lastName'] }],
            order: [['topPickRank', 'ASC']],
        });

        const linked = await loadLinkedStatus(items);
        const isFacilitatorHere = board.createdById === user.id
            || user.role === 'SUPERUSER'
            || user.roleName === 'superuser'
            || user.roleName === 'admin'
            || user.roleName === 'manager';

        return {
            previousBoard: {
                id: previous.id,
                title: previous.title,
                meetingDate: previous.meetingDate,
                facilitatorName: previous.creator
                    ? `${previous.creator.firstName} ${previous.creator.lastName}`.trim()
                    : null,
            },
            points: items.map(item => ({
                id: item.id,
                content: item.content,
                topPickRank: item.topPickRank,
                laneKey: item.laneKey,
                // Anonymity is untouched here: an outcome annotates the CONTENT
                // of an agreed point, never its author, so no author is exposed.
                isAnonymous: item.isAnonymous,
                outcome: item.outcome,
                outcomeNote: item.outcomeNote,
                outcomeAt: item.outcomeAt,
                outcomeBy: item.outcomeBy
                    ? `${item.outcomeBy.firstName} ${item.outcomeBy.lastName}`.trim()
                    : null,
                linked: linked.get(item.id) ?? null,
                canSetOutcome: canSetOutcome(isFacilitatorHere, item),
            })),
        };
    },

    /**
     * Record what became of an agreed point.
     *
     * Authorisation already happened in the route: requireBoardAccess('facilitate')
     * ran against the REVIEWING board. This re-verifies the target item belongs
     * to a board on the same project, which is what stops a facilitator from
     * annotating another project's retro through this endpoint.
     */
    async setOutcome(reviewingBoard: RetroBoard, itemId: number, user: any, outcome: unknown, note?: unknown) {
        if (!VALID_OUTCOMES.includes(outcome as RetroOutcome)) {
            throw new HttpError(`outcome must be one of: ${VALID_OUTCOMES.join(', ')}`);
        }

        const item = await RetroItem.findByPk(itemId);
        if (!item) throw new HttpError('Agreed point not found', 404);

        if (item.topPickRank === null) {
            throw new HttpError('Only agreed top-3 points can be given an outcome');
        }

        const sourceBoard = await RetroBoard.findByPk(item.boardId);
        if (!sourceBoard || sourceBoard.projectId !== reviewingBoard.projectId) {
            throw new HttpError('That agreed point belongs to a different project', 403);
        }
        if (sourceBoard.id === reviewingBoard.id) {
            throw new HttpError('A retro cannot record outcomes against its own points', 400);
        }

        await item.update({
            outcome: outcome as RetroOutcome,
            outcomeNote: note ? String(note).trim().slice(0, 2000) : null,
            outcomeAt: new Date(),
            outcomeById: user.id,
            outcomeReviewedInBoardId: reviewingBoard.id,
        });

        return this.getCarryForward(reviewingBoard, user);
    },

    /**
     * Convert a previously agreed point into tracked work, from the retro that
     * is reviewing it.
     *
     * Exists separately from the normal convert endpoint for the same reason
     * setOutcome does: the normal route resolves permission from the board that
     * OWNS the item, which is the frozen previous board — so a different lead
     * running this retro would be refused. Authority here is "you facilitate the
     * reviewing retro"; provenance still records the ORIGINAL board, because
     * that is where the point was actually agreed.
     */
    async convertCarriedPoint(
        reviewingBoard: RetroBoard,
        itemId: number,
        user: any,
        target: 'ACTION_ITEM' | 'RISK',
        data: any
    ) {
        const item = await RetroItem.findByPk(itemId);
        if (!item) throw new HttpError('Agreed point not found', 404);
        if (item.topPickRank === null) {
            throw new HttpError('Only agreed top-3 points can be converted from a review');
        }

        const sourceBoard = await RetroBoard.findByPk(item.boardId);
        if (!sourceBoard || sourceBoard.projectId !== reviewingBoard.projectId) {
            throw new HttpError('That agreed point belongs to a different project', 403);
        }

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { retroConversionService } = require('./retroConversionService');
        if (target === 'ACTION_ITEM') {
            await retroConversionService.toActionItem(item, sourceBoard, user, data);
        } else {
            await retroConversionService.toRisk(item, sourceBoard, user, data);
        }

        return this.getCarryForward(reviewingBoard, user);
    },

    /**
     * Every agreed point ever recorded for a project, grouped into themes so
     * recurring-but-unactioned commitments stand out.
     */
    async getAgreedPointsHistory(projectId: number, user: any): Promise<{ themes: AgreedTheme[]; totalPoints: number }> {
        const isPrivileged =
            user.role === 'SUPERUSER' || user.roleName === 'superuser' || user.roleName === 'admin';

        if (!isPrivileged) {
            const accessible = await getAccessibleProjectIds(user.id);
            if (!accessible.has(projectId)) {
                throw new HttpError('Access denied: this project is not in your scope', 403);
            }
        }

        const boards = await RetroBoard.findAll({
            where: { projectId, status: { [Op.in]: ['ACTIVE', 'COMPLETED', 'ARCHIVED'] } },
            attributes: ['id', 'title', 'meetingDate'],
            order: [['meetingDate', 'ASC'], ['id', 'ASC']],
        });

        if (boards.length === 0) return { themes: [], totalPoints: 0 };

        const boardById = new Map(boards.map(b => [b.id, b]));
        const items = await RetroItem.findAll({
            where: { boardId: { [Op.in]: boards.map(b => b.id) }, topPickRank: { [Op.ne]: null as any } },
            order: [['id', 'ASC']],
        });

        // Chronological order matters: greedy clustering is order-dependent, and
        // feeding it oldest-first makes each theme read as it was first raised.
        const points: AgreedPointInput[] = items
            .map(item => {
                const b = boardById.get(item.boardId);
                return {
                    itemId: item.id,
                    boardId: item.boardId,
                    boardTitle: b?.title ?? '',
                    meetingDate: b?.meetingDate ?? '',
                    content: item.content,
                    topPickRank: item.topPickRank,
                    outcome: item.outcome,
                    convertedType: item.convertedType,
                    convertedRefId: item.convertedRefId,
                };
            })
            .sort((a, b) => a.meetingDate.localeCompare(b.meetingDate) || a.boardId - b.boardId);

        return { themes: groupIntoThemes(points), totalPoints: points.length };
    },
};
