import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../../../config/redis';
import { monthlyAccountReportService } from '../services/monthlyAccountReportService';
import { logger } from '../../../common/utils';

export const monthlyAccountReportQueue = new Queue('monthly-account-report-generation', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: 24 * 3600,
    },
});

const worker = new Worker(
    'monthly-account-report-generation',
    async (job: Job) => {
        const { accountId, month, year } = job.data;
        logger.info(`Starting async Monthly Account Report generation for Account ID ${accountId} (${month}/${year})`, 'MonthlyAccountReportQueue');

        try {
            await monthlyAccountReportService.generateMonthlyAccountReport(accountId, month, year, true);
            logger.info(`Successfully generated async Monthly Account Report for Account ID ${accountId}`, 'MonthlyAccountReportQueue');
        } catch (error: any) {
            logger.error(`Failed to generate async Monthly Account Report for Account ID ${accountId}`, error, 'MonthlyAccountReportQueue');
            throw error;
        }
    },
    {
        connection: redisConnection,
        concurrency: 5,
    }
);

worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed for Account ID ${job.data.accountId}`, 'MonthlyAccountReportQueue');
});

worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed`, err, 'MonthlyAccountReportQueue');
});

worker.on('error', (err) => {
    logger.error('Worker error', err, 'MonthlyAccountReportQueue');
});
