import Redis from 'ioredis';
import { config } from '../config';

class TokenBlacklistService {
    private redis: Redis;

    constructor() {
        this.redis = new Redis({
            host: config.redis.host,
            port: config.redis.port,
            // Add password if needed from config
        });

        this.redis.on('error', (err) => {
            console.error('Redis Client Error', err);
        });

        this.redis.on('connect', () => {
            console.log('Redis Client Connected for Token Blacklist');
        });
    }

    /**
     * Adds a token to the blacklist with an expiration time.
     * @param token The JWT token string.
     * @param expiresInSeconds The number of seconds until the token expires.
     */
    async addToBlacklist(token: string, expiresInSeconds: number): Promise<void> {
        const key = `blacklist:${token}`;
        await this.redis.set(key, 'true', 'EX', expiresInSeconds);
    }

    /**
     * Checks if a token is in the blacklist.
     * @param token The JWT token string.
     * @returns True if the token is blacklisted, false otherwise.
     */
    async isBlacklisted(token: string): Promise<boolean> {
        const key = `blacklist:${token}`;
        const result = await this.redis.get(key);
        return result === 'true';
    }

    // Helper to close connection if needed (e.g. tests)
    async quit() {
        await this.redis.quit();
    }
}

export const tokenBlacklistService = new TokenBlacklistService();
