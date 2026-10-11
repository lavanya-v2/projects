/* eslint-disable @typescript-eslint/no-explicit-any */
import http from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { config } from '../config';

/**
 * The socket.io singleton.
 *
 * getIO() deliberately returns null rather than throwing when sockets are not
 * running: every emit site is `getIO()?.of(...)`, so a dead or disabled realtime
 * layer degrades the UI to polling instead of failing REST writes. That is what
 * makes the socket layer an accelerator rather than a dependency.
 */
let io: Server | null = null;

export function initIO(httpServer: http.Server): Server {
    io = new Server(httpServer, {
        // Chosen so the existing Vite '/api' dev proxy rule matches (it needs
        // ws: true added). Any prod reverse proxy must allow the WebSocket
        // upgrade on this path.
        path: '/api/socket.io',
        // WebSocket only. The HTTP long-poll fallback requires sticky sessions,
        // which PM2's round-robin cluster mode does not provide; a single
        // upgraded connection sidesteps the problem entirely. Clients that
        // cannot open a WebSocket fall back to REST polling, not to long-poll.
        transports: ['websocket'],
        cors: { origin: true, credentials: true },
        pingInterval: 25_000,
        pingTimeout: 20_000,
    });

    // Cross-worker fan-out. ecosystem.config.js declares cluster mode with
    // instances: 'max', so without this two participants served by different
    // workers would never see each other — and it would look correct in dev,
    // where there is only one process.
    try {
        const pub = new Redis({ host: config.redis.host, port: config.redis.port });
        const sub = pub.duplicate();
        pub.on('error', (e: Error) => console.warn('⚠️  socket.io redis pub error:', e.message));
        sub.on('error', (e: Error) => console.warn('⚠️  socket.io redis sub error:', e.message));
        io.adapter(createAdapter(pub, sub));
        console.log('✅ socket.io redis adapter attached');
    } catch (e: any) {
        // Realtime degrades to single-worker fan-out; the app still works.
        console.warn('⚠️  socket.io redis adapter unavailable, realtime is single-worker only:', e?.message);
    }

    return io;
}

export function getIO(): Server | null {
    return io;
}

export async function closeIO(): Promise<void> {
    if (!io) return;
    await new Promise<void>(resolve => io!.close(() => resolve()));
    io = null;
}
