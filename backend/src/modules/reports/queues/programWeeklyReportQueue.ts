import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../../../config/redis';
import { programReportService } from '../services/programReportService';
import { logger } from '../../../common/utils';

export const programWeeklyReportQueue = new Queue('program-weekly-report-generation', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 24 * 3600,
    },
});

const worker = new Worker(
    'program-weekly-report-generation',
    async (job: Job) => {
        const { programId, startDate, endDate } = job.data as {
            programId: number; startDate: string; endDate: string;
        };
        logger.info(`Starting async Weekly Program Report for Program ${programId} (${startDate} to ${endDate})`, 'ProgramWeeklyReportQueue');
        try {
            await programReportService.generateProgramWeeklyReport(programId, startDate, endDate, true);
            logger.info(`Generated Weekly Program Report for Program ${programId}`, 'ProgramWeeklyReportQueue');
        } catch (error: any) {
            if (error?.statusCode === 422) {
                logger.warn(`Skipping Program ${programId} (${startDate}-${endDate}): ${error.message}`, 'ProgramWeeklyReportQueue');
                return;
            }
            logger.error(`Failed Weekly Program Report for Program ${programId}`, error, 'ProgramWeeklyReportQueue');
            throw error;
        }
    },
    {
        connection: redisConnection,
        concurrency: 5,
    }
);

worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed for Program ${job.data.programId}`, 'ProgramWeeklyReportQueue');
});
worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed`, err, 'ProgramWeeklyReportQueue');
});
worker.on('error', (err) => {
    logger.error('Worker error', err, 'ProgramWeeklyReportQueue');
});
