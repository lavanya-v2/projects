import { ConnectionOptions } from 'bullmq';
import { config } from './index';

export const redisConnection: ConnectionOptions = {
    host: config.redis.host,
    port: config.redis.port,
};
