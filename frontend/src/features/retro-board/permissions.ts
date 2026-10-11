import type { RetroItem, RetroItemPermissions, RetroBoardStatus } from './types';

/**
 * Client-side mirror of the server's resolveRetroItemPermissions.
 *
 * Why this exists: a socket broadcast is identical for every subscriber, but
 * permissions are per-requester. Rather than the server computing and emitting
 * N personalised copies of every event, it broadcasts the permission-free item
 * and each client derives its own view here.
 *
 * This drives button visibility ONLY. Every mutation is re-checked server-side,
 * so a tampered client gains nothing but misleading buttons.
 */

const ANON_UNDO_WINDOW_MS = 60_000;

export interface DeriveContext {
  currentUserId: number;
  boardStatus: RetroBoardStatus;
  votingEnabled: boolean;
  isFacilitator: boolean;
  now?: number;
}

function boardWritable(status: RetroBoardStatus, isFacilitator: boolean): boolean {
  if (status === 'ACTIVE') return true;
  if (status === 'DRAFT') return isFacilitator;
  return false;
}

export function deriveItemPermissions(item: RetroItem, ctx: DeriveContext): RetroItemPermissions {
  const { isFacilitator, boardStatus } = ctx;
  const now = ctx.now ?? Date.now();

  if (!boardWritable(boardStatus, isFacilitator)) {
    return {
      canEdit: false,
      canDelete: false,
      canComment: false,
      canMove: false,
      canVote: false,
      canMarkTopPick: false,
      canConvert: isFacilitator && boardStatus === 'COMPLETED',
    };
  }

  const base = {
    canComment: true,
    canVote: ctx.votingEnabled,
    canMarkTopPick: isFacilitator,
    canConvert: isFacilitator,
  };

  if (item.isAnonymous) {
    // No author is stored, so there is nothing to compare against — this is
    // unconditionally false rather than "hidden". Note we never receive an
    // authorId for anonymous items, so this cannot accidentally become true.
    const withinUndo =
      now - new Date(item.createdAt).getTime() < ANON_UNDO_WINDOW_MS &&
      item.voteCount === 0 &&
      item.commentCount === 0;

    return {
      ...base,
      canEdit: false,
      canDelete: isFacilitator || withinUndo,
      canMove: isFacilitator,
    };
  }

  const isAuthor = item.author?.id === ctx.currentUserId;

  return {
    ...base,
    canEdit: isAuthor || isFacilitator,
    canDelete: isAuthor || isFacilitator,
    canMove: isAuthor || isFacilitator,
  };
}

/** Re-derive permissions for every item — used after a socket broadcast. */
export function withDerivedPermissions(items: RetroItem[], ctx: DeriveContext): RetroItem[] {
  return items.map(i => ({ ...i, permissions: deriveItemPermissions(i, ctx) }));
}
