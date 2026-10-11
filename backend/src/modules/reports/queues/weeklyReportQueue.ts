import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../../../config/redis';
import { reportService } from '../services/reportService';
import { logger } from '../../../common/utils';
import { config } from '../../../config';

export const weeklyReportQueue = new Queue('weekly-report-generation', {
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
    'weekly-report-generation',
    async (job: Job) => {
        const { projectName, startDate, endDate } = job.data;
        logger.info(`Starting async Weekly Project Report generation for Project ${projectName} (${startDate} to ${endDate})`, 'WeeklyReportQueue');

        try {
            await reportService.generateWeeklyReport(projectName, startDate, endDate, true);
            logger.info(`Successfully generated async Weekly Project Report for Project ${projectName}`, 'WeeklyReportQueue');
        } catch (error: any) {
            logger.error(`Failed to generate async Weekly Project Report for Project ${projectName}`, error, 'WeeklyReportQueue');
            throw error;
        }
    },
    {
        connection: redisConnection,
        concurrency: 5,
    }
);

worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed for Project ${job.data.projectName}`, 'WeeklyReportQueue');
});

worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed`, err, 'WeeklyReportQueue');
});

worker.on('error', (err) => {
    logger.error('Worker error', err, 'WeeklyReportQueue');
});
