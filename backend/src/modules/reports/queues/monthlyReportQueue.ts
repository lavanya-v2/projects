import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../../../config/redis';
import { monthlyReportService } from '../services/monthlyReportService';
import { logger } from '../../../common/utils';
import { config } from '../../../config';

export const monthlyReportQueue = new Queue('monthly-report-generation', {
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

const worker = new Worker(
    'monthly-report-generation',
    async (job: Job) => {
        const { projectId, month, year } = job.data;
        logger.info(`Starting async Monthly Project Report generation for Project ID ${projectId} (${month}/${year})`, 'MonthlyReportQueue');

        try {
            await monthlyReportService.generateProjectMonthlyReport(projectId, month, year, true);
            logger.info(`Successfully generated async Monthly Project Report for Project ID ${projectId}`, 'MonthlyReportQueue');
        } catch (error: any) {
            logger.error(`Failed to generate async Monthly Project Report for Project ID ${projectId}`, error, 'MonthlyReportQueue');
            throw error;
        }
    },
    {
        connection: redisConnection,
        concurrency: 5,
    }
);

worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed for Project ID ${job.data.projectId}`, 'MonthlyReportQueue');
});

worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed`, err, 'MonthlyReportQueue');
});

worker.on('error', (err) => {
    logger.error('Worker error', err, 'MonthlyReportQueue');
});
