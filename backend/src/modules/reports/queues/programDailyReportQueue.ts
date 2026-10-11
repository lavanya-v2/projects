import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../../../config/redis';
import { programDailyReportService } from '../services/programDailyReportService';
import { logger } from '../../../common/utils';

export const programDailyReportQueue = new Queue('program-daily-report-generation', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 24 * 3600,
    },
});

const worker = new Worker(
    'program-daily-report-generation',
    async (job: Job) => {
        const { programId, date } = job.data as { programId: number; date: string };
        logger.info(`Starting async Daily Program Report for Program ${programId} on ${date}`, 'ProgramDailyReportQueue');
        try {
            await programDailyReportService.generateDailyProgramReport(programId, date, true);
            logger.info(`Generated Daily Program Report for Program ${programId} on ${date}`, 'ProgramDailyReportQueue');
        } catch (error: any) {
            // Empty programs return statusCode 422; log and let BullMQ skip retry for known non-retryable errors
            if (error?.statusCode === 422) {
                logger.warn(`Skipping Program ${programId} (${date}): ${error.message}`, 'ProgramDailyReportQueue');
                return;
            }
            logger.error(`Failed Daily Program Report for Program ${programId} on ${date}`, error, 'ProgramDailyReportQueue');
            throw error;
        }
    },
    {
        connection: redisConnection,
        concurrency: 3,
    }
);

worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed for Program ${job.data.programId}`, 'ProgramDailyReportQueue');
});
worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed`, err, 'ProgramDailyReportQueue');
});
worker.on('error', (err) => {
    logger.error('Worker error', err, 'ProgramDailyReportQueue');
});
