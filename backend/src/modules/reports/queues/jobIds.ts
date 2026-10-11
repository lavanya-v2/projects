/**
 * Canonical BullMQ job ids for the scheduled report queues.
 *
 * Production runs PM2 in cluster mode, so every instance starts its own scheduler
 * and fires the same cron at the same second. BullMQ refuses to create a job whose
 * id already exists, so a stable id derived from the report's natural identity
 * (project/account + period) collapses those duplicate enqueues into one job.
 * Redis is the only coordination point needed — no leader election, no lock.
 *
 * These live in one module on purpose: the scheduler and the manual re-run
 * endpoints must build byte-identical ids, or dedup silently stops working with
 * nothing in the logs to show for it.
 *
 * Enqueue rules:
 *   - Scheduler: add() with the id and NO remove() — dropping the duplicate is the point.
 *   - User-triggered: remove() then add(), since removeOnFail retains a failed job
 *     for 24h and would otherwise swallow a human's retry.
 */

/** Today in IST as YYYY-MM-DD. Matches SchedulerService.getISTDateStr(). */
export const istDateStr = (): string =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** Daily board report, keyed by project code + report date. */
export const dsrJobId = (projectCode: string, date: string): string =>
    `dsr-${projectCode}-${date}`;

/** Weekly project report, keyed by project code + Friday that starts the Fri-Thu week. */
export const weeklyJobId = (projectCode: string, startDate: string): string =>
    `weekly-${projectCode}-${startDate}`;

/** Weekly account rollup, keyed by account + week start. */
export const accountWeeklyJobId = (accountId: number, startDate: string): string =>
    `account-weekly-${accountId}-${startDate}`;

/** Monthly project report, keyed by project + month. */
export const monthlyJobId = (projectId: number, month: number, year: number): string =>
    `monthly-${projectId}-${year}-${month}`;

/** Monthly account rollup, keyed by account + month. */
export const monthlyAccountJobId = (accountId: number, month: number, year: number): string =>
    `monthly-account-${accountId}-${year}-${month}`;
