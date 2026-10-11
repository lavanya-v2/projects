import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../../../config/redis';
import { performanceSyncService } from '../services/performanceSyncService';
import { logger } from '../../../common/utils';

export const perfSyncQueue = new Queue('performance-sync', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: 24 * 3600,
    },
});

const worker = new Worker(
    'performance-sync',
    async (job: Job) => {
        const { projectId, jiraSprintId, fromDate, toDate, label, triggeredByUserId } = job.data;

        if (jiraSprintId) {
            logger.info(`Starting sprint performance sync for project ${projectId}, sprint ${jiraSprintId}`, 'PerfSyncQueue');
            await performanceSyncService.syncSprint(projectId, jiraSprintId, triggeredByUserId);
            logger.info(`Sprint sync complete for sprint ${jiraSprintId}`, 'PerfSyncQueue');
        } else if (fromDate && toDate) {
            logger.info(`Starting Kanban performance sync for project ${projectId}, period ${label}`, 'PerfSyncQueue');
            await performanceSyncService.syncKanbanPeriod(projectId, fromDate, toDate, label ?? `${fromDate} to ${toDate}`, triggeredByUserId);
            logger.info(`Kanban sync complete for period ${label}`, 'PerfSyncQueue');
        } else {
            throw new Error('Invalid job data: need either jiraSprintId or fromDate+toDate');
        }
    },
    {
        connection: redisConnection,
        concurrency: 2,
    }
);

worker.on('completed', (job) => {
    logger.info(`Perf sync job ${job.id} completed`, 'PerfSyncQueue');
});

worker.on('failed', (job, err) => {
    logger.error(`Perf sync job ${job?.id} failed: ${err.message}`, err, 'PerfSyncQueue');
});

worker.on('error', (err) => {
    logger.error('PerfSync worker error', err, 'PerfSyncQueue');
});
