/* eslint-disable @typescript-eslint/no-explicit-any */
import jwt from 'jsonwebtoken';
import { Socket } from 'socket.io';
import { UserRole } from '../models/UserRole';
import { Role } from '../models/Role';
import { tokenBlacklistService } from '../services/tokenBlacklistService';

/**
 * Socket handshake authentication.
 *
 * Mirrors what authenticate() does for HTTP, but cannot reuse it: that
 * middleware is written against req/res. Keeping this as a separate function
 * rather than a shim keeps both honest.
 *
 * The blacklist check matters more here than on a REST call — a socket is a
 * long-lived connection, so skipping it would leave a logged-out user with a
 * live feed of the board until they close the tab.
 */
export interface SocketUser {
    id: number;
    userId: string;
    role: string;
    roleName: string;
    token: string;
    tokenExp: number | null;
}

export async function authenticateSocket(socket: Socket): Promise<SocketUser> {
    const token: string | undefined =
        socket.handshake.auth?.token || (socket.handshake.headers?.authorization as string)?.split(' ')[1];

    if (!token) throw new Error('unauthorized: no token');

    if (await tokenBlacklistService.isBlacklisted(token)) {
        throw new Error('unauthorized: token invalidated');
    }

    const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'default_secret_key');

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { User } = require('../models/User');
    const user = await User.findByPk(decoded.id);
    if (!user) throw new Error('unauthorized: user not found');

    const userRoleRecord = await UserRole.findOne({
        where: { userId: user.id },
        include: [{ model: Role, as: 'role' }],
    });
    const primaryRoleName = (userRoleRecord as any)?.role?.name || null;
    const legacyRole =
        user.role === 'SUPERUSER' ? 'SUPERUSER' : primaryRoleName === 'superuser' ? 'SUPERUSER' : 'USER';

    return {
        id: user.id,
        userId: user.userId,
        role: legacyRole,
        roleName: primaryRoleName || 'member',
        token,
        tokenExp: typeof decoded.exp === 'number' ? decoded.exp : null,
    };
}
