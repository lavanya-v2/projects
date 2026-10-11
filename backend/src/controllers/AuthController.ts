import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { User } from '../models/User';
import { UserRole } from '../models/UserRole';
import { Role } from '../models/Role';
import { tokenBlacklistService } from '../services/tokenBlacklistService';
import { usageTrackingService } from '../services/usageTrackingService';

export class AuthController {
    // Logout user
    static async logout(req: Request, res: Response) {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(200).json({ message: 'Logged out successfully' });
            }

            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(200).json({ message: 'Logged out successfully' });
            }

            // Decode token to get expiration
            const decoded: any = jwt.decode(token);
            let expiresIn = 24 * 60 * 60; // Default 24h

            if (decoded && decoded.exp) {
                const now = Math.floor(Date.now() / 1000);
                expiresIn = decoded.exp - now;
            }

            if (expiresIn > 0) {
                await tokenBlacklistService.addToBlacklist(token, expiresIn);
            }

            // Close the usage session. Tokens minted before session tracking
            // existed carry no `sid` — endSession no-ops on those.
            await usageTrackingService.endSession(decoded?.sid, 'logout');

            res.status(200).json({ message: 'Logged out successfully' });
        } catch (error: any) {
            console.error('Logout error:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    // Register a new user
    static async register(req: Request, res: Response) {
        try {
            const { firstName, lastName, userId, password } = req.body;

            if (!firstName || !lastName || !userId || !password) {
                return res.status(400).json({ error: 'All fields are required' });
            }

            const existingUser = await User.findOne({ where: { userId } });
            if (existingUser) {
                return res.status(409).json({ error: 'User ID already exists' });
            }

            const user = await User.create({
                firstName,
                lastName,
                userId,
                password
            });

            // Return user without password
            const { password: _, ...userWithoutPassword } = user.toJSON();

            res.status(201).json(userWithoutPassword);
        } catch (error: any) {
            console.error('Registration error:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    // Login user and return JWT
    static async login(req: Request, res: Response) {
        try {
            const { userId, password } = req.body;

            if (!userId || !password) {
                return res.status(400).json({ error: 'User ID and password are required' });
            }

            const user = await User.findOne({ where: { userId } });
            if (!user) {
                // Generic error - don't reveal user doesn't exist
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const isPasswordValid = await user.checkPassword(password);
            if (!isPasswordValid) {
                // Generic error - don't reveal password is wrong
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Resolve roleName from user_roles table
            const userRoleRecord = await UserRole.findOne({
                where: { userId: user.id },
                include: [{ model: Role, as: 'role' }]
            });
            // Honor the legacy SUPERUSER ENUM if no user_roles record promotes the user explicitly,
            // so seeded superusers are not silently demoted to 'member' for fine-grained checks.
            const resolvedRoleName: string | undefined = (userRoleRecord as any)?.role?.name;
            const roleName: string =
                resolvedRoleName || (user.role === 'SUPERUSER' ? 'superuser' : 'member');

            // `sid` correlates this login with every request that follows it,
            // which is what makes session duration measurable.
            const sid = randomUUID();

            const token = jwt.sign(
                { id: user.id, userId: user.userId, role: user.role, sid },
                process.env.JWT_SECRET || 'default_secret_key',
                { expiresIn: '24h' }
            );

            await usageTrackingService.startSession({
                userId: user.id,
                sessionId: sid,
                roleName,
                ipAddress: req.ip || null,
                userAgent: req.headers['user-agent'] || null,
            });

            res.json({
                token,
                user: {
                    id: user.id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    userId: user.userId,
                    role: user.role,
                    roleName
                }
            });
        } catch (error: any) {
            console.error('Login error:', error);
            // Generic error - don't expose internal details
            res.status(500).json({ error: 'An error occurred' });
        }
    }
}
