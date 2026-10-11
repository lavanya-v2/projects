import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../../../config/redis';
import { aiService } from '../../ai';
import { ClaudeUsageCoaching } from '../../../models/ClaudeUsageCoaching';
import { claudeUsageReportService } from '../services/claudeUsageReportService';
import { logger } from '../../../common/utils';

/**
 * Generates AI prompt-coaching for one user from AGGREGATE signals only (no prompt
 * text ever reaches the model), then caches it in claude_usage_coaching. The member
 * report prefers the cached AI tips and falls back to deterministic heuristics.
 */
export const coachingQueue = new Queue('claude-coaching', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: 24 * 3600,
    },
});

export async function enqueueCoaching(userId: number): Promise<void> {
    await coachingQueue.add('generate-coaching', { userId });
}

const worker = new Worker(
    'claude-coaching',
    async (job: Job) => {
        const { userId } = job.data as { userId: number };
        // Reuse the report builder to get the content-free aggregates, then map to
        // the coaching input. getMyReport only needs the user's id.
        const r = await claudeUsageReportService.getMyReport({ id: userId });
        const totalQ = r.totals.good + r.totals.ok + r.totals.poor || 1;
        const sig = (k: string) => r.signals.find((s) => s.key === k)?.pct ?? 0;
        const round = (n: number) => Math.round(n);

        const tips = await aiService.generatePromptCoaching({
            prompts: r.totals.prompts,
            avgScore: r.totals.avgScore,
            goodPct: round((r.totals.good / totalQ) * 100),
            okPct: round((r.totals.ok / totalQ) * 100),
            poorPct: round((r.totals.poor / totalQ) * 100),
            noContextPct: sig('no_context'),
            reworkPct: r.vibe.reworkPct,
            vaguePct: r.vibe.vaguePct,
            veryShortPct: sig('very_short'),
            structuredRatioPct: r.vibe.structuredRatioPct,
            toolAssistedPct: r.vibe.toolAssistedPct,
            skillInvocations: r.vibe.skillInvocations,
            mcpCalls: r.vibe.mcpCalls,
            vibeIndex: r.vibe.index,
        });

        if (!tips.length) {
            logger.info(`No AI coaching tips produced for user ${userId}; keeping heuristics`, 'CoachingQueue');
            return;
        }

        const existing = await ClaudeUsageCoaching.findOne({ where: { userId } });
        if (existing) {
            await existing.update({
                tips,
                model: 'claude-sonnet-4-5',
                basedOnFrom: r.range.from,
                basedOnTo: r.range.to,
                generatedAt: new Date(),
            });
        } else {
            await ClaudeUsageCoaching.create({
                userId,
                tips,
                model: 'claude-sonnet-4-5',
                basedOnFrom: r.range.from,
                basedOnTo: r.range.to,
            } as any);
        }
    },
    { connection: redisConnection, concurrency: 2 },
);

worker.on('failed', (job, err) => {
    logger.error(`Coaching job ${job?.id} failed`, err, 'CoachingQueue');
});
worker.on('error', (err) => {
    logger.error('Coaching worker error', err, 'CoachingQueue');
});
