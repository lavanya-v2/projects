import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../../../config/redis';
import { reportService } from '../services/reportService';
import { logger } from '../../../common/utils';

// Define the Queue
export const dsrQueue = new Queue('dsr-generation', {
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
  'dsr-generation',
  async (job: Job) => {
    const { projectName, date } = job.data;
    const dateStr = date || 'today';
    logger.info(`Starting DSR generation for ${projectName} on ${dateStr}`, 'DSRQueue');

    try {
      // Always force regeneration when queued async (that's the point of async generation!)
      await reportService.generateBoardReport(projectName, Array.isArray(date) ? date[0] : date, true);
      logger.info(`Successfully generated DSR for ${projectName} on ${dateStr}`, 'DSRQueue');
    } catch (error) {
      logger.error(`Failed to generate DSR for ${projectName} on ${dateStr}`, error as Error, 'DSRQueue');
      throw error; // Re-throw to trigger BullMQ retry/failure
    }
  },
  {
    connection: redisConnection,
    concurrency: 2, // Allow processing exactly 2 concurrent reports to restrict Token/Rate limit spikes
  }
);

worker.on('completed', job => {
  logger.info(`Job ${job.id} completed for ${job.data.projectName}`, 'DSRQueue');
});

worker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed`, err, 'DSRQueue');
});

worker.on('error', err => {
  logger.error('Worker error', err, 'DSRQueue');
});
