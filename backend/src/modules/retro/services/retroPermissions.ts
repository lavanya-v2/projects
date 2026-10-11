/**
 * Retro board permission resolution.
 *
 * Pure functions, no model imports — mirrors the shape of
 * modules/risks/services/riskPermissions.ts. The result is serialized onto every
 * item so the frontend cards can render controls without re-deriving the rules,
 * exactly as Risk.permissions does. The server still re-checks authoritatively
 * on every mutation; the serialized copy only drives button visibility.
 */

import type { RetroBoardStatus } from '../../../models/RetroBoard';

export interface RetroItemPermissions {
    canEdit: boolean;
    canDelete: boolean;
    canComment: boolean;
    canMove: boolean;
    canVote: boolean;
    canMarkTopPick: boolean;
    canConvert: boolean;
}

export interface RetroBoardPermissions {
    canEditSettings: boolean;
    canEditLanes: boolean;
    canAddItems: boolean;
    canChangeStatus: boolean;
    canMarkTopPicks: boolean;
    canConvert: boolean;
    canExportPdf: boolean;
    canDelete: boolean;
}

const ALL_ITEM_FALSE: RetroItemPermissions = {
    canEdit: false,
    canDelete: false,
    canComment: false,
    canMove: false,
    canVote: false,
    canMarkTopPick: false,
    canConvert: false,
};

/**
 * How long after posting an anonymous item it may still be withdrawn.
 *
 * Anonymous items have no author to authorise against, so "let the author
 * delete their own" is not expressible. Rather than trusting a client-asserted
 * list of "ids I created" — which the server cannot verify and anyone could
 * forge — the withdraw right is granted by properties the server can check
 * itself: the item is brand new and nobody has engaged with it yet. Narrow
 * enough to have no abuse value, wide enough to cover the real case (typo, or
 * posted to the wrong lane).
 */
export const ANON_UNDO_WINDOW_MS = 60_000;

export interface RequestingUser {
    id: number;
    roleName: string;
}

export interface BoardContext {
    status: RetroBoardStatus;
    createdById: number;
    votingEnabled: boolean;
}

export interface ItemContext {
    authorId: number | null;
    isAnonymous: boolean;
    createdAt: Date;
    voteCount: number;
    commentCount: number;
    convertedType: string | null;
}

/**
 * The facilitator is the board's creator, plus anyone senior enough to moderate.
 * Deliberately does NOT include 'lead' generally — a lead who did not create
 * this board is an ordinary participant on it.
 */
export function isFacilitator(user: RequestingUser, board: { createdById: number }): boolean {
    return (
        board.createdById === user.id ||
        user.roleName === 'superuser' ||
        user.roleName === 'admin' ||
        user.roleName === 'manager'
    );
}

/**
 * Whether the board currently accepts writes at all.
 *
 * DRAFT is the facilitator's private setup phase; ACTIVE is the meeting itself.
 * COMPLETED and ARCHIVED are frozen — this is the single point where the rule
 * "once it is discussed, no further edits" is enforced. Items converted into
 * action items or risks are unaffected: those carry their own lifecycle
 * forward, while the retro record stays exactly as it was agreed.
 */
export function isBoardWritable(board: BoardContext, facilitator: boolean): boolean {
    if (board.status === 'ACTIVE') return true;
    if (board.status === 'DRAFT') return facilitator;
    return false;
}

export function resolveRetroItemPermissions(
    user: RequestingUser,
    item: ItemContext,
    board: BoardContext,
    facilitator: boolean,
    now: Date = new Date()
): RetroItemPermissions {
    // Frozen board: the record is immutable. Conversion stays open for the
    // facilitator because retros end in the evening and follow-up happens the
    // next morning.
    if (!isBoardWritable(board, facilitator)) {
        return {
            ...ALL_ITEM_FALSE,
            canConvert: facilitator && board.status === 'COMPLETED',
        };
    }

    const base = {
        canComment: true,
        canVote: board.votingEnabled,
        canMarkTopPick: facilitator,
        canConvert: facilitator,
    };

    if (item.isAnonymous) {
        // No author is stored, so there is nobody to compare the requester
        // against. Editing is therefore impossible for everyone — not hidden,
        // genuinely unavailable. Deletion is allowed only as facilitator
        // moderation, or inside the withdraw window described above.
        const withinUndoWindow =
            now.getTime() - new Date(item.createdAt).getTime() < ANON_UNDO_WINDOW_MS &&
            item.voteCount === 0 &&
            item.commentCount === 0;

        return {
            ...base,
            canEdit: false,
            canDelete: facilitator || withinUndoWindow,
            canMove: facilitator,
        };
    }

    const isAuthor = item.authorId !== null && item.authorId === user.id;

    return {
        ...base,
        canEdit: isAuthor || facilitator,
        canDelete: isAuthor || facilitator,
        // Lanes are semantic — moving someone's card changes what it means.
        // Authors may reposition their own; facilitators may regroup during
        // the meeting.
        canMove: isAuthor || facilitator,
    };
}

export function resolveRetroBoardPermissions(
    _user: RequestingUser,
    board: BoardContext,
    facilitator: boolean
): RetroBoardPermissions {
    const writable = isBoardWritable(board, facilitator);
    const frozen = board.status === 'COMPLETED' || board.status === 'ARCHIVED';

    return {
        canEditSettings: facilitator && !frozen,
        canEditLanes: facilitator && !frozen,
        canAddItems: writable,
        canChangeStatus: facilitator && board.status !== 'ARCHIVED',
        canMarkTopPicks: facilitator && board.status !== 'ARCHIVED',
        canConvert: facilitator && board.status !== 'DRAFT' && board.status !== 'ARCHIVED',
        canExportPdf: true,
        canDelete: facilitator && board.status !== 'ARCHIVED',
    };
}

/**
 * Board lifecycle. Mirrors the ALLOWED_TRANSITIONS shape used by
 * actionItemService so the two state machines read the same way.
 */
export const ALLOWED_BOARD_TRANSITIONS: Record<RetroBoardStatus, RetroBoardStatus[]> = {
    DRAFT: ['ACTIVE', 'ARCHIVED'],
    ACTIVE: ['COMPLETED', 'ARCHIVED'],
    COMPLETED: ['ARCHIVED'],
    ARCHIVED: [],
};

/**
 * Whether a user may record an outcome against a previously agreed point.
 *
 * Note what this does NOT depend on: the old board's facilitator. Guarding the
 * write on the board that produced the point would break the moment a different
 * lead runs the next retro, since that board's createdById is someone else.
 * Authority here comes from "you are facilitating the retro doing the review",
 * which is the real-world authority — so the caller passes the facilitator flag
 * for the CURRENT board, and the frozen board needs no permission relaxation.
 *
 * Outcomes apply only to agreed points, so an item with no rank is not eligible.
 */
export function canSetOutcome(
    isFacilitatorOfReviewingBoard: boolean,
    item: { topPickRank: number | null }
): boolean {
    return isFacilitatorOfReviewingBoard && item.topPickRank !== null;
}
