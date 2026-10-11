/* eslint-disable @typescript-eslint/no-explicit-any */
import { Server, Socket } from 'socket.io';
import { authenticateSocket, type SocketUser } from '../../../realtime/socketAuth';
import { getAccessibleProjectIds } from '../../../common/projectAccess';
import { RetroBoard } from '../../../models/RetroBoard';
import { RetroBoardParticipant } from '../../../models/RetroBoardParticipant';
import { isFacilitator } from '../services/retroPermissions';
import { RETRO_NAMESPACE, boardRoom } from './retroEvents';

/**
 * The retro realtime gateway.
 *
 * Deliberately one-way: clients join rooms and receive changes, but every
 * mutation still goes through REST. That keeps a single authorisation path, a
 * single validation path, and — importantly — makes the polling fallback a
 * degradation of the same code path rather than a second implementation.
 */

const TOKEN_RECHECK_MS = 5 * 60 * 1000;

interface RetroSocketData {
    user: SocketUser;
    accessibleProjectIds: Set<number> | null;
    joinedBoards: Set<number>;
}

function isPrivileged(user: SocketUser): boolean {
    return user.role === 'SUPERUSER' || user.roleName === 'superuser' || user.roleName === 'admin';
}

async function canAccessBoard(socket: Socket, board: RetroBoard): Promise<boolean> {
    const data = socket.data as RetroSocketData;
    if (isPrivileged(data.user)) return true;

    // Cached for the connection's lifetime. Consequence, accepted knowingly: a
    // permission revocation takes effect on the user's next connect rather than
    // instantly.
    if (!data.accessibleProjectIds) {
        data.accessibleProjectIds = await getAccessibleProjectIds(data.user.id);
    }
    if (!data.accessibleProjectIds.has(board.projectId)) return false;

    // A DRAFT board is the facilitator's private setup space.
    if (board.status === 'DRAFT' && !isFacilitator({ id: data.user.id, roleName: data.user.roleName }, board)) {
        return false;
    }
    return true;
}

async function broadcastPresence(nsp: any, boardId: number) {
    const participants = await RetroBoardParticipant.findAll({
        where: { boardId },
        include: [{ association: 'user', attributes: ['id', 'firstName', 'lastName'] }],
        order: [['firstJoinedAt', 'ASC']],
    });

    const sockets = await nsp.in(boardRoom(boardId)).fetchSockets();
    const onlineIds = new Set(sockets.map((s: any) => s.data?.user?.id));

    nsp.to(boardRoom(boardId)).emit('retro:presence', {
        boardId,
        participants: participants.map((p: any) => ({
            userId: p.userId,
            name: p.user ? `${p.user.firstName} ${p.user.lastName}`.trim() : 'Unknown',
            online: onlineIds.has(p.userId),
        })),
    });
}

export function registerRetroGateway(io: Server): void {
    const nsp = io.of(RETRO_NAMESPACE);

    nsp.use(async (socket, next) => {
        try {
            const user = await authenticateSocket(socket);
            socket.data = { user, accessibleProjectIds: null, joinedBoards: new Set() } as RetroSocketData;
            next();
        } catch (e: any) {
            next(new Error(e?.message || 'unauthorized'));
        }
    });

    nsp.on('connection', (socket: Socket) => {
        const data = socket.data as RetroSocketData;

        // A tab left open overnight must not keep streaming on an expired
        // token. JWTs here last 24h, so re-check periodically rather than only
        // at handshake.
        const expiryTimer = setInterval(() => {
            if (data.user.tokenExp && data.user.tokenExp * 1000 < Date.now()) {
                socket.disconnect(true);
            }
        }, TOKEN_RECHECK_MS);

        socket.on('retro:join', async ({ boardId }: { boardId: number }, ack?: (r: any) => void) => {
            try {
                const board = await RetroBoard.findByPk(boardId);
                if (!board) return ack?.({ error: 'not_found' });

                // Authorisation happens here, not at connect: being logged in
                // says nothing about whether you belong on THIS board.
                if (!(await canAccessBoard(socket, board))) {
                    return ack?.({ error: 'forbidden' });
                }

                socket.join(boardRoom(boardId));
                data.joinedBoards.add(boardId);

                await RetroBoardParticipant.findOrCreate({
                    where: { boardId, userId: data.user.id },
                    defaults: { boardId, userId: data.user.id } as any,
                });

                await broadcastPresence(nsp, boardId);
                ack?.({ ok: true });
            } catch (e: any) {
                console.error('retro:join failed:', e);
                ack?.({ error: 'server_error' });
            }
        });

        socket.on('retro:leave', async ({ boardId }: { boardId: number }) => {
            socket.leave(boardRoom(boardId));
            data.joinedBoards.delete(boardId);
            await broadcastPresence(nsp, boardId).catch(() => {});
        });

        socket.on('retro:typing', ({ boardId, laneKey }: { boardId: number; laneKey: string }) => {
            if (!data.joinedBoards.has(boardId)) return;
            socket.to(boardRoom(boardId)).emit('retro:typing', {
                boardId,
                laneKey,
                userId: data.user.id,
            });
        });

        socket.on('retro:presence_ping', async ({ boardId }: { boardId: number }) => {
            if (!data.joinedBoards.has(boardId)) return;
            await RetroBoardParticipant.update(
                { lastSeenAt: new Date() },
                { where: { boardId, userId: data.user.id } }
            ).catch(() => {});
        });

        socket.on('disconnect', async () => {
            clearInterval(expiryTimer);
            for (const boardId of data.joinedBoards) {
                await broadcastPresence(nsp, boardId).catch(() => {});
            }
        });
    });

    console.log('✅ retro realtime gateway registered at /retro');
}
