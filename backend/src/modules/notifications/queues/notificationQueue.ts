import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../../../config/redis';
import { logger } from '../../../common/utils';
import { config } from '../../../config';
import { processSendJob, processFlushJob } from '../services/notificationWorker';

export const NOTIFICATION_QUEUE_NAME = 'notifications';

export const notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 500 },
        removeOnFail: 24 * 3600,
    },
});

export type NotificationJobName = 'sendNotification' | 'flushPendingAggregate';

export interface SendJobData {
    ruleId: number;
    payload: Record<string, unknown>;
    payloadScope: { projectId?: number | null; accountId?: number | null };
}

export interface FlushJobData {
    pendingId: number;
}

// Only start worker when notifications are enabled
let worker: Worker | null = null;

if (config.notifications.enabled) {
    worker = new Worker(
        NOTIFICATION_QUEUE_NAME,
        async (job: Job) => {
            if (job.name === 'sendNotification') {
                await processSendJob(job as Job<SendJobData>);
            } else if (job.name === 'flushPendingAggregate') {
                await processFlushJob(job as Job<FlushJobData>);
            } else {
                logger.warn(`Unknown notification job name: ${job.name}`, 'NotificationQueue');
            }
        },
        { connection: redisConnection, concurrency: 5 }
    );

    worker.on('completed', (job) => {
        logger.info(`Notification job ${job.id} (${job.name}) completed`, 'NotificationQueue');
    });
    worker.on('failed', (job, err) => {
        logger.error(`Notification job ${job?.id} (${job?.name}) failed`, err, 'NotificationQueue');
    });
    worker.on('error', (err) => {
        logger.error('Notification worker error', err, 'NotificationQueue');
    });
}

export { worker as notificationWorker };
