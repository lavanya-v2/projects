/**
 * The ONLY module permitted to read author_id off a retro item or comment.
 *
 * Everything leaving the backend goes through here, so the anonymity guarantee
 * is enforced in exactly one place rather than re-litigated at each call site.
 * If you find yourself reaching for `item.authorId` in a controller, add a
 * field here instead.
 */

import {
    resolveRetroItemPermissions,
    resolveRetroBoardPermissions,
    isFacilitator,
    type RequestingUser,
    type RetroItemPermissions,
    type RetroBoardPermissions,
} from './retroPermissions';
import type { RetroBoard, RetroLane, RetroBoardStatus } from '../../../models/RetroBoard';
import type { RetroItem } from '../../../models/RetroItem';
import type { RetroItemComment } from '../../../models/RetroItemComment';

export interface RetroAuthorDTO {
    id: number;
    firstName: string;
    lastName: string;
}

export interface RetroItemDTO {
    id: number;
    boardId: number;
    laneKey: string;
    content: string;
    isAnonymous: boolean;
    author: RetroAuthorDTO | null;
    sortOrder: number;
    topPickRank: number | null;
    voteCount: number;
    hasVoted: boolean;
    commentCount: number;
    converted: { type: string; refId: number; at: Date | null } | null;
    createdAt: Date;
    permissions: RetroItemPermissions;
}

export interface RetroCommentDTO {
    id: number;
    itemId: number;
    comment: string;
    isAnonymous: boolean;
    author: RetroAuthorDTO | null;
    createdAt: Date;
    editedAt: Date | null;
    canEdit: boolean;
    canDelete: boolean;
}

export interface RetroBoardDTO {
    id: number;
    projectId: number;
    projectName?: string;
    title: string;
    meetingDate: string;
    meetingTime: string;
    timezone: string;
    status: RetroBoardStatus;
    lanes: RetroLane[];
    shareToken: string;
    allowAnonymous: boolean;
    votingEnabled: boolean;
    votesPerUser: number;
    createdById: number;
    facilitatorName: string | null;
    completedAt: Date | null;
    createdAt: Date;
    isFacilitator: boolean;
    permissions: RetroBoardPermissions;
}

/**
 * Round a timestamp down to the minute.
 *
 * Microsecond-precision createdAt, correlated against socket join events or
 * simple "who was typing just then", is enough to attribute an anonymous item
 * in a small room. Coarsening removes the cheap version of that attack. It does
 * not make small-group retros anonymous in an information-theoretic sense —
 * nothing can — which is why the UI says so plainly instead.
 */
function coarsenToMinute(d: Date): Date {
    const c = new Date(d);
    c.setSeconds(0, 0);
    return c;
}

function toAuthorDTO(user: { id: number; firstName: string; lastName: string } | null | undefined): RetroAuthorDTO | null {
    if (!user) return null;
    // Note the omission: never email. The retro board has no use for it and it
    // is the field most likely to end up pasted into a screenshot.
    return { id: user.id, firstName: user.firstName, lastName: user.lastName };
}

export interface ItemSerializationContext {
    user: RequestingUser;
    board: { status: RetroBoardStatus; createdById: number; votingEnabled: boolean };
    facilitator: boolean;
    voteCounts: Map<number, number>;
    votedItemIds: Set<number>;
    commentCounts: Map<number, number>;
    now?: Date;
}

export function toItemDTO(item: RetroItem, ctx: ItemSerializationContext): RetroItemDTO {
    const voteCount = ctx.voteCounts.get(item.id) ?? 0;
    const commentCount = ctx.commentCounts.get(item.id) ?? 0;

    const permissions = resolveRetroItemPermissions(
        ctx.user,
        {
            authorId: item.authorId,
            isAnonymous: item.isAnonymous,
            createdAt: item.createdAt,
            voteCount,
            commentCount,
            convertedType: item.convertedType,
        },
        ctx.board,
        ctx.facilitator,
        ctx.now
    );

    return {
        id: item.id,
        boardId: item.boardId,
        laneKey: item.laneKey,
        content: item.content,
        isAnonymous: item.isAnonymous,
        // The whole point. An anonymous item carries no author downstream —
        // not an id, not a name, not a placeholder that could be joined back.
        author: item.isAnonymous ? null : toAuthorDTO(item.author),
        sortOrder: item.sortOrder,
        topPickRank: item.topPickRank,
        voteCount,
        // Only ever the requester's own vote state. A voter list would
        // de-anonymise every anonymous item its author voted for.
        hasVoted: ctx.votedItemIds.has(item.id),
        commentCount,
        converted: item.convertedType
            ? { type: item.convertedType, refId: item.convertedRefId as number, at: item.convertedAt }
            : null,
        createdAt: item.isAnonymous ? coarsenToMinute(item.createdAt) : item.createdAt,
        permissions,
    };
}

export function toCommentDTO(
    comment: RetroItemComment,
    ctx: { user: RequestingUser; facilitator: boolean; boardWritable: boolean }
): RetroCommentDTO {
    const isAuthor = comment.authorId !== null && comment.authorId === ctx.user.id;

    return {
        id: comment.id,
        itemId: comment.itemId,
        comment: comment.comment,
        isAnonymous: comment.isAnonymous,
        author: comment.isAnonymous ? null : toAuthorDTO(comment.author),
        createdAt: comment.isAnonymous ? coarsenToMinute(comment.createdAt) : comment.createdAt,
        editedAt: comment.editedAt,
        // Same consequence as items: an anonymous comment has no author to
        // authorise against, so it cannot be edited by anyone.
        canEdit: ctx.boardWritable && !comment.isAnonymous && isAuthor,
        canDelete: ctx.boardWritable && ((!comment.isAnonymous && isAuthor) || ctx.facilitator),
    };
}

export function toBoardDTO(board: RetroBoard, user: RequestingUser): RetroBoardDTO {
    const facilitator = isFacilitator(user, board);
    const boardCtx = {
        status: board.status,
        createdById: board.createdById,
        votingEnabled: board.votingEnabled,
    };

    return {
        id: board.id,
        projectId: board.projectId,
        projectName: (board as { project?: { name?: string } }).project?.name,
        title: board.title,
        meetingDate: board.meetingDate,
        meetingTime: board.meetingTime,
        timezone: board.timezone,
        status: board.status,
        lanes: [...(board.lanes ?? [])].sort((a, b) => a.order - b.order),
        shareToken: board.shareToken,
        allowAnonymous: board.allowAnonymous,
        votingEnabled: board.votingEnabled,
        votesPerUser: board.votesPerUser,
        createdById: board.createdById,
        facilitatorName: board.creator
            ? `${board.creator.firstName} ${board.creator.lastName}`.trim()
            : null,
        completedAt: board.completedAt,
        createdAt: board.createdAt,
        isFacilitator: facilitator,
        permissions: resolveRetroBoardPermissions(user, boardCtx, facilitator),
    };
}
