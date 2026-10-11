/* eslint-disable @typescript-eslint/no-explicit-any */
import { Op, fn, col } from 'sequelize';
import sequelize from '../../../config/connection';
import { RetroBoard } from '../../../models/RetroBoard';
import { RetroItem } from '../../../models/RetroItem';
import { RetroItemComment } from '../../../models/RetroItemComment';
import { RetroItemVote } from '../../../models/RetroItemVote';
import { User } from '../../../models/User';
import {
    resolveRetroItemPermissions,
    isFacilitator,
    isBoardWritable,
} from './retroPermissions';
import { toItemDTO, toCommentDTO } from './retroSerializer';
import { emitToBoard } from '../realtime/retroEvents';
import { HttpError } from './retroBoardService';

const MAX_CONTENT_LENGTH = 2000;

async function countsFor(itemId: number, userId: number) {
    const [voteCount, commentCount, myVote] = await Promise.all([
        RetroItemVote.count({ where: { itemId } }),
        RetroItemComment.count({ where: { itemId } }),
        RetroItemVote.findOne({ where: { itemId, userId } }),
    ]);
    return {
        voteCounts: new Map([[itemId, voteCount]]),
        commentCounts: new Map([[itemId, commentCount]]),
        votedItemIds: new Set(myVote ? [itemId] : []),
    };
}

async function serializeOne(item: RetroItem, board: RetroBoard, user: any) {
    const fresh = (await RetroItem.findByPk(item.id, {
        include: [{ model: User, as: 'author', attributes: ['id', 'firstName', 'lastName'] }],
    })) as RetroItem;

    const counts = await countsFor(item.id, user.id);
    const requester = { id: user.id, roleName: user.roleName };

    return toItemDTO(fresh, {
        user: requester,
        board: { status: board.status, createdById: board.createdById, votingEnabled: board.votingEnabled },
        facilitator: isFacilitator(requester, board),
        ...counts,
    });
}

/** Re-derive an item's permissions server-side. Never trust the client copy. */
async function permissionsFor(item: RetroItem, board: RetroBoard, user: any) {
    const [voteCount, commentCount] = await Promise.all([
        RetroItemVote.count({ where: { itemId: item.id } }),
        RetroItemComment.count({ where: { itemId: item.id } }),
    ]);
    const requester = { id: user.id, roleName: user.roleName };
    return resolveRetroItemPermissions(
        requester,
        {
            authorId: item.authorId,
            isAnonymous: item.isAnonymous,
            createdAt: item.createdAt,
            voteCount,
            commentCount,
            convertedType: item.convertedType,
        },
        { status: board.status, createdById: board.createdById, votingEnabled: board.votingEnabled },
        isFacilitator(requester, board)
    );
}

export const retroItemService = {
    async createItem(board: RetroBoard, user: any, data: any) {
        const content = String(data.content ?? '').trim();
        if (!content) throw new HttpError('content is required');
        if (content.length > MAX_CONTENT_LENGTH) {
            throw new HttpError(`content must be ${MAX_CONTENT_LENGTH} characters or fewer`);
        }

        const laneKey = String(data.laneKey ?? '');
        if (!board.lanes?.some(l => l.key === laneKey)) {
            throw new HttpError(`Unknown lane: ${laneKey}`);
        }

        const anonymous = !!data.isAnonymous;
        if (anonymous && !board.allowAnonymous) {
            throw new HttpError('This board does not allow anonymous items');
        }

        const maxOrder = (await RetroItem.max('sortOrder', {
            where: { boardId: board.id, laneKey },
        })) as number | null;

        // The anonymity guarantee, at the only place it can actually be made:
        // for an anonymous item the author is simply never written. There is no
        // hidden column to leak later.
        const item = await RetroItem.create({
            boardId: board.id,
            laneKey,
            content,
            isAnonymous: anonymous,
            authorId: anonymous ? null : user.id,
            authorRoleName: anonymous ? null : (user.roleName ?? 'member'),
            sortOrder: (maxOrder ?? 0) + 1,
        } as any);

        const dto = await serializeOne(item, board, user);
        emitToBoard(board.id, 'retro:item_created', { boardId: board.id, item: dto });
        return dto;
    },

    async updateItem(item: RetroItem, board: RetroBoard, user: any, data: any) {
        const perms = await permissionsFor(item, board, user);

        const patch: any = {};

        if (data.content !== undefined) {
            if (!perms.canEdit) {
                throw new HttpError(
                    item.isAnonymous
                        ? 'Anonymous items cannot be edited — we do not store who wrote them'
                        : 'You cannot edit this item',
                    403
                );
            }
            const content = String(data.content).trim();
            if (!content) throw new HttpError('content cannot be empty');
            if (content.length > MAX_CONTENT_LENGTH) {
                throw new HttpError(`content must be ${MAX_CONTENT_LENGTH} characters or fewer`);
            }
            patch.content = content;
        }

        if (data.laneKey !== undefined || data.sortOrder !== undefined) {
            if (!perms.canMove) throw new HttpError('You cannot move this item', 403);
            if (data.laneKey !== undefined) {
                if (!board.lanes?.some(l => l.key === data.laneKey)) {
                    throw new HttpError(`Unknown lane: ${data.laneKey}`);
                }
                patch.laneKey = data.laneKey;
            }
            if (data.sortOrder !== undefined) patch.sortOrder = parseInt(data.sortOrder);
        }

        if (Object.keys(patch).length === 0) return serializeOne(item, board, user);

        await item.update(patch);
        const dto = await serializeOne(item, board, user);
        emitToBoard(board.id, patch.laneKey !== undefined ? 'retro:item_moved' : 'retro:item_updated', {
            boardId: board.id,
            item: dto,
            itemId: item.id,
            laneKey: item.laneKey,
            sortOrder: item.sortOrder,
        });
        return dto;
    },

    async deleteItem(item: RetroItem, board: RetroBoard, user: any) {
        const perms = await permissionsFor(item, board, user);
        if (!perms.canDelete) {
            throw new HttpError(
                item.isAnonymous
                    ? 'This anonymous item can no longer be withdrawn'
                    : 'You cannot delete this item',
                403
            );
        }
        const itemId = item.id;
        await item.destroy();
        emitToBoard(board.id, 'retro:item_deleted', { boardId: board.id, itemId });
        return { id: itemId };
    },

    /**
     * Toggle a vote.
     *
     * Votes store user_id — unavoidable if one-vote-per-item and the per-user
     * budget are to mean anything. The serializer never returns a voter list,
     * so this does not expose who voted for what to other participants.
     */
    async toggleVote(item: RetroItem, board: RetroBoard, user: any) {
        if (!board.votingEnabled) throw new HttpError('Voting is disabled on this board');

        // Count-then-insert must be atomic: two votes cast in the same instant
        // could otherwise each read used === cap - 1 and both succeed, letting a
        // user overspend by one. The unique index cannot catch it, since the two
        // votes are on different items. Cheap to lock at retro scale.
        await sequelize.transaction(async t => {
            const existing = await RetroItemVote.findOne({
                where: { itemId: item.id, userId: user.id },
                transaction: t,
                lock: t.LOCK.UPDATE,
            });

            if (existing) {
                await existing.destroy({ transaction: t });
                return;
            }

            if (board.votesPerUser > 0) {
                const boardItemIds = (
                    await RetroItem.findAll({
                        where: { boardId: board.id }, attributes: ['id'], raw: true, transaction: t,
                    })
                ).map((r: any) => r.id);
                const used = await RetroItemVote.count({
                    where: { userId: user.id, itemId: { [Op.in]: boardItemIds.concat([-1]) } },
                    transaction: t,
                });
                if (used >= board.votesPerUser) {
                    throw new HttpError(
                        `You have used all ${board.votesPerUser} of your votes. Remove one to vote elsewhere.`,
                        409
                    );
                }
            }
            await RetroItemVote.create({ itemId: item.id, userId: user.id } as any, { transaction: t });
        });

        const voteCount = await RetroItemVote.count({ where: { itemId: item.id } });
        emitToBoard(board.id, 'retro:vote_changed', { boardId: board.id, itemId: item.id, voteCount });
        return serializeOne(item, board, user);
    },

    /**
     * Set or clear an item's top-3 rank.
     *
     * A partial unique index enforces one item per rank per board, so claiming a
     * rank another item holds must clear that one in the same transaction or the
     * write fails. Emitting the full pick set rather than a delta avoids
     * ordering races between the two changes on the client.
     */
    async setTopPick(item: RetroItem, board: RetroBoard, user: any, rank: number | null) {
        if (rank !== null && ![1, 2, 3].includes(rank)) {
            throw new HttpError('rank must be 1, 2, 3, or null');
        }

        await sequelize.transaction(async t => {
            if (rank !== null) {
                await RetroItem.update(
                    { topPickRank: null },
                    { where: { boardId: board.id, topPickRank: rank }, transaction: t }
                );
            }
            await item.update({ topPickRank: rank }, { transaction: t });
        });

        const picks = await RetroItem.findAll({
            where: { boardId: board.id, topPickRank: { [Op.ne]: null as any } },
            attributes: ['id', 'topPickRank'],
            order: [['topPickRank', 'ASC']],
            raw: true,
        });

        emitToBoard(board.id, 'retro:top_picks_changed', {
            boardId: board.id,
            picks: picks.map((p: any) => ({ itemId: p.id, rank: p.topPickRank })),
        });

        return serializeOne(item, board, user);
    },

    async listComments(item: RetroItem, board: RetroBoard, user: any) {
        const comments = await RetroItemComment.findAll({
            where: { itemId: item.id },
            include: [{ model: User, as: 'author', attributes: ['id', 'firstName', 'lastName'] }],
            order: [['createdAt', 'ASC']],
        });

        const requester = { id: user.id, roleName: user.roleName };
        const facilitator = isFacilitator(requester, board);
        const writable = isBoardWritable(board, facilitator);

        return comments.map(c => toCommentDTO(c, { user: requester, facilitator, boardWritable: writable }));
    },

    async createComment(item: RetroItem, board: RetroBoard, user: any, data: any) {
        const text = String(data.comment ?? '').trim();
        if (!text) throw new HttpError('comment is required');
        if (text.length > MAX_CONTENT_LENGTH) {
            throw new HttpError(`comment must be ${MAX_CONTENT_LENGTH} characters or fewer`);
        }

        const anonymous = !!data.isAnonymous;
        if (anonymous && !board.allowAnonymous) {
            throw new HttpError('This board does not allow anonymous comments');
        }

        const comment = await RetroItemComment.create({
            itemId: item.id,
            authorId: anonymous ? null : user.id,
            isAnonymous: anonymous,
            comment: text,
        } as any);

        const fresh = (await RetroItemComment.findByPk(comment.id, {
            include: [{ model: User, as: 'author', attributes: ['id', 'firstName', 'lastName'] }],
        })) as RetroItemComment;

        const requester = { id: user.id, roleName: user.roleName };
        const facilitator = isFacilitator(requester, board);
        const dto = toCommentDTO(fresh, { user: requester, facilitator, boardWritable: true });
        const commentCount = await RetroItemComment.count({ where: { itemId: item.id } });

        emitToBoard(board.id, 'retro:comment_created', {
            boardId: board.id,
            itemId: item.id,
            comment: dto,
            commentCount,
        });

        return dto;
    },

    async updateComment(comment: RetroItemComment, item: RetroItem, board: RetroBoard, user: any, data: any) {
        if (comment.isAnonymous) {
            throw new HttpError('Anonymous comments cannot be edited — we do not store who wrote them', 403);
        }
        if (comment.authorId !== user.id) {
            throw new HttpError('You can only edit your own comments', 403);
        }

        const text = String(data.comment ?? '').trim();
        if (!text) throw new HttpError('comment cannot be empty');

        await comment.update({ comment: text, editedAt: new Date() });

        const fresh = (await RetroItemComment.findByPk(comment.id, {
            include: [{ model: User, as: 'author', attributes: ['id', 'firstName', 'lastName'] }],
        })) as RetroItemComment;

        const requester = { id: user.id, roleName: user.roleName };
        const dto = toCommentDTO(fresh, {
            user: requester,
            facilitator: isFacilitator(requester, board),
            boardWritable: true,
        });

        emitToBoard(board.id, 'retro:comment_updated', { boardId: board.id, itemId: item.id, comment: dto });
        return dto;
    },

    async deleteComment(comment: RetroItemComment, item: RetroItem, board: RetroBoard, user: any) {
        const requester = { id: user.id, roleName: user.roleName };
        const facilitator = isFacilitator(requester, board);
        const isAuthor = !comment.isAnonymous && comment.authorId === user.id;

        if (!isAuthor && !facilitator) {
            throw new HttpError('You cannot delete this comment', 403);
        }

        const commentId = comment.id;
        await comment.destroy();
        const commentCount = await RetroItemComment.count({ where: { itemId: item.id } });

        emitToBoard(board.id, 'retro:comment_deleted', {
            boardId: board.id,
            itemId: item.id,
            commentId,
            commentCount,
        });

        return { id: commentId };
    },

    serializeOne,
    permissionsFor,
};
