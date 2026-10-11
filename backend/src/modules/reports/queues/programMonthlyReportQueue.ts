import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../../../config/redis';
import { monthlyProgramReportService } from '../services/monthlyProgramReportService';
import { logger } from '../../../common/utils';

export const programMonthlyReportQueue = new Queue('program-monthly-report-generation', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 24 * 3600,
    },
});

const worker = new Worker(
    'program-monthly-report-generation',
    async (job: Job) => {
        const { programId, month, year } = job.data as { programId: number; month: number; year: number };
        logger.info(`Starting async Monthly Program Report for Program ${programId} (${month}/${year})`, 'ProgramMonthlyReportQueue');
        try {
            await monthlyProgramReportService.generateMonthlyProgramReport(programId, month, year, true);
            logger.info(`Generated Monthly Program Report for Program ${programId} (${month}/${year})`, 'ProgramMonthlyReportQueue');
        } catch (error: any) {
            if (error?.statusCode === 422) {
                logger.warn(`Skipping Program ${programId} (${month}/${year}): ${error.message}`, 'ProgramMonthlyReportQueue');
                return;
            }
            logger.error(`Failed Monthly Program Report for Program ${programId}`, error, 'ProgramMonthlyReportQueue');
            throw error;
        }
    },
    {
        connection: redisConnection,
        concurrency: 5,
    }
);

worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed for Program ${job.data.programId}`, 'ProgramMonthlyReportQueue');
});
worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed`, err, 'ProgramMonthlyReportQueue');
});
worker.on('error', (err) => {
    logger.error('Worker error', err, 'ProgramMonthlyReportQueue');
});
