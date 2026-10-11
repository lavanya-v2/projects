/* eslint-disable @typescript-eslint/no-explicit-any */
import { getIO } from '../../../realtime/io';

export const RETRO_NAMESPACE = '/retro';

export const boardRoom = (boardId: number) => `board:${boardId}`;

export type RetroServerEvent =
    | 'retro:item_created'
    | 'retro:item_updated'
    | 'retro:item_deleted'
    | 'retro:item_moved'
    | 'retro:vote_changed'
    | 'retro:top_picks_changed'
    | 'retro:comment_created'
    | 'retro:comment_updated'
    | 'retro:comment_deleted'
    | 'retro:board_updated'
    | 'retro:item_converted'
    | 'retro:presence';

/**
 * Fan a change out to everyone on a board.
 *
 * Null-safe by design: if the socket layer is down or was never started, this
 * is a no-op and clients pick the change up on their next poll. A realtime
 * outage must never turn a successful write into a failed request.
 *
 * Payloads carry already-serialized DTOs, so anonymity is enforced once in
 * retroSerializer rather than at each emit site. Note that a room broadcast is
 * identical for every socket, so these DTOs deliberately do NOT carry
 * requester-specific `permissions` — the client recomputes those locally, and
 * the server re-checks authoritatively on every mutation regardless.
 */
export function emitToBoard(boardId: number, event: RetroServerEvent, payload: any): void {
    try {
        getIO()?.of(RETRO_NAMESPACE).to(boardRoom(boardId)).emit(event, payload);
    } catch (e: any) {
        console.warn(`⚠️  retro emit failed (${event}):`, e?.message);
    }
}
