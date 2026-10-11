import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../../../config/redis';
import { accountReportService } from '../services/accountReportService';
import { logger } from '../../../common/utils';
import { config } from '../../../config';

// Define the Queue
export const accountReportQueue = new Queue('account-report-generation', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: 24 * 3600, // Keep failed jobs for 24 hours
    },
});

// Define the Worker
const worker = new Worker(
    'account-report-generation',
    async (job: Job) => {
        const { accountId, startDate, endDate } = job.data;
        logger.info(`Starting async Account Weekly Report generation for Account ID ${accountId} (${startDate} to ${endDate})`, 'AccountReportQueue');

        try {
            // Force true because by definition if it's in this queue, the user explicitly clicked regenerate
            await accountReportService.generateAccountWeeklyReport(accountId, startDate, endDate, true);
            logger.info(`Successfully generated async Account Weekly Report for Account ID ${accountId}`, 'AccountReportQueue');
        } catch (error: any) {
            logger.error(`Failed to generate async Account Weekly Report for Account ID ${accountId}`, error, 'AccountReportQueue');
            throw error; // Re-throw to trigger BullMQ retry/failure
        }
    },
    {
        connection: redisConnection,
        concurrency: 5, // Process multiple reports in parallel
    }
);

worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed for Account ID ${job.data.accountId}`, 'AccountReportQueue');
});

worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed`, err, 'AccountReportQueue');
});

worker.on('error', (err) => {
    logger.error('Worker error', err, 'AccountReportQueue');
});
