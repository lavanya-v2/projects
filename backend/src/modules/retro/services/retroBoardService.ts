/* eslint-disable @typescript-eslint/no-explicit-any */
import { Op, fn, col } from 'sequelize';
import sequelize from '../../../config/connection';
import { RetroBoard, type RetroLane } from '../../../models/RetroBoard';
import { RetroItem } from '../../../models/RetroItem';
import { RetroItemComment } from '../../../models/RetroItemComment';
import { RetroItemVote } from '../../../models/RetroItemVote';
import { RetroBoardParticipant } from '../../../models/RetroBoardParticipant';
import { User } from '../../../models/User';
import { Project } from '../../../models/Project';
import { getAccessibleProjectIds } from '../../../common/projectAccess';
import { resolveTemplateLanes, normaliseLanes, LaneValidationError } from './retroLaneTemplates';
import { ALLOWED_BOARD_TRANSITIONS, isFacilitator, isBoardWritable } from './retroPermissions';
import { parseVotesPerUser } from './voteBudget';
import { toBoardDTO, toItemDTO, type RetroItemDTO, type RetroBoardDTO } from './retroSerializer';
import { emitToBoard } from '../realtime/retroEvents';

class HttpError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const BOARD_INCLUDE = [
  { model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] },
  { model: Project, attributes: ['id', 'name'] },
];

/**
 * Aggregate vote and comment counts for a set of items in two queries rather
 * than N+1. Both are needed to serialize any item (vote counts drive the top-3
 * ordering; comment counts drive the anonymous withdraw window).
 */
async function loadItemCounts(itemIds: number[], userId: number) {
  if (itemIds.length === 0) {
    return {
      voteCounts: new Map<number, number>(),
      votedItemIds: new Set<number>(),
      commentCounts: new Map<number, number>(),
    };
  }

  const [voteRows, myVotes, commentRows] = await Promise.all([
    RetroItemVote.findAll({
      where: { itemId: { [Op.in]: itemIds } },
      attributes: ['itemId', [fn('COUNT', col('id')), 'count']],
      group: ['itemId'],
      raw: true,
    }) as any,
    RetroItemVote.findAll({
      where: { itemId: { [Op.in]: itemIds }, userId },
      attributes: ['itemId'],
      raw: true,
    }) as any,
    RetroItemComment.findAll({
      where: { itemId: { [Op.in]: itemIds } },
      attributes: ['itemId', [fn('COUNT', col('id')), 'count']],
      group: ['itemId'],
      raw: true,
    }) as any,
  ]);

  return {
    voteCounts: new Map<number, number>(voteRows.map((r: any) => [r.itemId, parseInt(r.count)])),
    votedItemIds: new Set<number>(myVotes.map((r: any) => r.itemId)),
    commentCounts: new Map<number, number>(commentRows.map((r: any) => [r.itemId, parseInt(r.count)])),
  };
}

export const retroBoardService = {
  async listBoards(user: any, filters: { projectId?: number; status?: string }) {
    const isPrivileged = user.role === 'SUPERUSER' || user.roleName === 'superuser';

    const where: any = {};
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.status) where.status = filters.status;

    if (!isPrivileged) {
      const accessible = await getAccessibleProjectIds(user.id);
      const ids = [...accessible];
      if (ids.length === 0) return [];
      where.projectId = {
        [Op.in]: filters.projectId ? (accessible.has(filters.projectId) ? [filters.projectId] : []) : ids,
      };
    }

    const boards = await RetroBoard.findAll({
      where,
      include: BOARD_INCLUDE,
      order: [
        ['meetingDate', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    // A DRAFT board is the facilitator's private setup space; it should not
    // appear in the team's list until it is opened.
    const visible = boards.filter(
      b => b.status !== 'DRAFT' || isFacilitator({ id: user.id, roleName: user.roleName }, b)
    );

    return visible.map(b => toBoardDTO(b, { id: user.id, roleName: user.roleName }));
  },

  async createBoard(user: any, data: any): Promise<RetroBoardDTO> {
    const projectId = parseInt(data.projectId);
    if (!projectId || Number.isNaN(projectId)) throw new HttpError('projectId is required');
    if (!data.title?.trim()) throw new HttpError('title is required');
    if (!data.meetingDate) throw new HttpError('meetingDate is required');
    if (!data.meetingTime) throw new HttpError('meetingTime is required');

    // A lead may only create a board on a project they can actually reach.
    // This lives here rather than in middleware because there is no board
    // to resolve yet.
    const isPrivileged = user.role === 'SUPERUSER' || user.roleName === 'superuser' || user.roleName === 'admin';
    if (!isPrivileged) {
      const accessible = await getAccessibleProjectIds(user.id);
      if (!accessible.has(projectId)) {
        throw new HttpError('Access denied: this project is not in your scope', 403);
      }
    }

    const lanes = resolveTemplateLanes(data.laneTemplate, data.lanes);

    const board = await RetroBoard.create({
      projectId,
      title: data.title.trim().slice(0, 255),
      meetingDate: data.meetingDate,
      meetingTime: data.meetingTime,
      timezone: data.timezone || 'Asia/Kolkata',
      status: 'DRAFT',
      lanes,
      allowAnonymous: data.allowAnonymous !== false,
      votingEnabled: data.votingEnabled !== false,
      votesPerUser: data.votesPerUser === undefined ? 3 : parseVotesPerUser(data.votesPerUser),
      createdById: user.id,
    } as any);

    const created = await RetroBoard.findByPk(board.id, { include: BOARD_INCLUDE });
    return toBoardDTO(created as RetroBoard, { id: user.id, roleName: user.roleName });
  },

  /** Full board payload: board + lanes + all items, serialized for this user. */
  async getBoardDetail(board: RetroBoard, user: any) {
    const items = await RetroItem.findAll({
      where: { boardId: board.id },
      include: [{ model: User, as: 'author', attributes: ['id', 'firstName', 'lastName'] }],
      order: [
        ['laneKey', 'ASC'],
        ['sortOrder', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const counts = await loadItemCounts(
      items.map(i => i.id),
      user.id
    );
    const requester = { id: user.id, roleName: user.roleName };
    const facilitator = isFacilitator(requester, board);

    const itemDTOs: RetroItemDTO[] = items.map(item =>
      toItemDTO(item, {
        user: requester,
        board: { status: board.status, createdById: board.createdById, votingEnabled: board.votingEnabled },
        facilitator,
        ...counts,
      })
    );

    const participants = await RetroBoardParticipant.findAll({
      where: { boardId: board.id },
      include: [{ model: User, attributes: ['id', 'firstName', 'lastName'] }],
      order: [['firstJoinedAt', 'ASC']],
    });

    const votesUsed = await RetroItemVote.count({
      where: { userId: user.id, itemId: { [Op.in]: items.map(i => i.id).concat([-1]) } },
    });

    return {
      board: toBoardDTO(board, requester),
      items: itemDTOs,
      participants: participants.map(p => ({
        userId: p.userId,
        name: p.user ? `${p.user.firstName} ${p.user.lastName}`.trim() : 'Unknown',
        firstJoinedAt: p.firstJoinedAt,
      })),
      myVotesUsed: votesUsed,
    };
  },

  async updateBoard(board: RetroBoard, user: any, data: any) {
    const patch: any = {};
    if (data.title !== undefined) patch.title = String(data.title).trim().slice(0, 255);
    if (data.meetingDate !== undefined) patch.meetingDate = data.meetingDate;
    if (data.meetingTime !== undefined) patch.meetingTime = data.meetingTime;
    if (data.timezone !== undefined) patch.timezone = data.timezone;
    if (data.allowAnonymous !== undefined) patch.allowAnonymous = !!data.allowAnonymous;
    // Deliberately independent of votesPerUser: turning voting off must not
    // wipe the budget, or turning it back on would silently mean unlimited.
    if (data.votingEnabled !== undefined) patch.votingEnabled = !!data.votingEnabled;
    if (data.votesPerUser !== undefined) patch.votesPerUser = parseVotesPerUser(data.votesPerUser);

    await board.update(patch);
    const fresh = (await RetroBoard.findByPk(board.id, { include: BOARD_INCLUDE })) as RetroBoard;
    const dto = toBoardDTO(fresh, { id: user.id, roleName: user.roleName });
    emitToBoard(board.id, 'retro:board_updated', { boardId: board.id, board: dto });
    return dto;
  },

  /**
   * Replace the lane set.
   *
   * Lanes are JSONB with no FK from retro_items.lane_key, so referential
   * integrity is this function's job: keys are immutable, and a lane holding
   * items cannot be dropped without saying where those items should go.
   */
  async updateLanes(board: RetroBoard, user: any, lanesInput: Partial<RetroLane>[], reassign?: Record<string, string>) {
    const next = normaliseLanes(lanesInput, board.lanes);
    const nextKeys = new Set(next.map(l => l.key));
    const previousKeys = new Set((board.lanes ?? []).map(l => l.key));

    for (const lane of lanesInput) {
      if (lane.key && !previousKeys.has(lane.key) && nextKeys.has(lane.key)) {
        // New lane — fine.
        continue;
      }
    }

    const removed = [...previousKeys].filter(k => !nextKeys.has(k));

    await sequelize.transaction(async t => {
      for (const key of removed) {
        const orphanCount = await RetroItem.count({
          where: { boardId: board.id, laneKey: key },
          transaction: t,
        });
        if (orphanCount === 0) continue;

        const target = reassign?.[key];
        if (!target || !nextKeys.has(target)) {
          throw new LaneValidationError(
            `Lane "${key}" still holds ${orphanCount} item(s). Choose a lane to move them to before removing it.`
          );
        }
        await RetroItem.update({ laneKey: target }, { where: { boardId: board.id, laneKey: key }, transaction: t });
      }

      await board.update({ lanes: next }, { transaction: t });
    });

    const fresh = (await RetroBoard.findByPk(board.id, { include: BOARD_INCLUDE })) as RetroBoard;
    const dto = toBoardDTO(fresh, { id: user.id, roleName: user.roleName });
    emitToBoard(board.id, 'retro:board_updated', { boardId: board.id, board: dto });
    return dto;
  },

  async changeStatus(board: RetroBoard, user: any, nextStatus: string) {
    const allowed = ALLOWED_BOARD_TRANSITIONS[board.status] ?? [];
    if (!allowed.includes(nextStatus as any)) {
      throw new HttpError(
        `Cannot move a ${board.status.toLowerCase()} board to ${String(nextStatus).toLowerCase()}`,
        409
      );
    }

    await board.update({
      status: nextStatus,
      completedAt: nextStatus === 'COMPLETED' ? new Date() : board.completedAt,
    } as any);

    const fresh = (await RetroBoard.findByPk(board.id, { include: BOARD_INCLUDE })) as RetroBoard;
    const dto = toBoardDTO(fresh, { id: user.id, roleName: user.roleName });
    // Participants' boards go read-only live when the facilitator closes it.
    emitToBoard(board.id, 'retro:board_updated', { boardId: board.id, board: dto });
    return dto;
  },

  async joinBoard(board: RetroBoard, user: any) {
    const [participant] = await RetroBoardParticipant.findOrCreate({
      where: { boardId: board.id, userId: user.id },
      defaults: { boardId: board.id, userId: user.id } as any,
    });
    await participant.update({ lastSeenAt: new Date() });

    const participants = await RetroBoardParticipant.findAll({
      where: { boardId: board.id },
      include: [{ model: User, attributes: ['id', 'firstName', 'lastName'] }],
      order: [['firstJoinedAt', 'ASC']],
    });

    return participants.map(p => ({
      userId: p.userId,
      name: p.user ? `${p.user.firstName} ${p.user.lastName}`.trim() : 'Unknown',
      firstJoinedAt: p.firstJoinedAt,
    }));
  },

  /**
   * Denormalised payload for the PDF, in one call so the document never
   * renders against partially-loaded data.
   */
  async getSummary(board: RetroBoard, user: any) {
    const detail = await this.getBoardDetail(board, user);

    const comments = await RetroItemComment.findAll({
      where: { itemId: { [Op.in]: detail.items.map(i => i.id).concat([-1]) } },
      include: [{ model: User, as: 'author', attributes: ['id', 'firstName', 'lastName'] }],
      order: [['createdAt', 'ASC']],
    });

    const commentsByItem = new Map<number, any[]>();
    for (const c of comments) {
      const list = commentsByItem.get(c.itemId) ?? [];
      list.push({
        id: c.id,
        comment: c.comment,
        isAnonymous: c.isAnonymous,
        author: c.isAnonymous || !c.author ? null : `${c.author.firstName} ${c.author.lastName}`.trim(),
        createdAt: c.createdAt,
      });
      commentsByItem.set(c.itemId, list);
    }

    const topPicks = detail.items
      .filter(i => i.topPickRank !== null)
      .sort((a, b) => (a.topPickRank as number) - (b.topPickRank as number));

    const conversions = detail.items.filter(i => i.converted !== null);

    return {
      ...detail,
      comments: Object.fromEntries(commentsByItem),
      topPicks,
      conversions,
    };
  },

  async archiveBoard(board: RetroBoard, user: any) {
    return this.changeStatus(board, user, 'ARCHIVED');
  },

  isBoardWritableFor(board: RetroBoard, user: any) {
    return isBoardWritable(board, isFacilitator({ id: user.id, roleName: user.roleName }, board));
  },
};

export { HttpError };
