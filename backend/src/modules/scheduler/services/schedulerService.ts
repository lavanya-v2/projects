import * as schedule from 'node-schedule';
import { config } from '../../../config';
import { dsrQueue } from '../../reports/queues/dsrQueue';
import { Project } from '../../../models/Project';
import { Account } from '../../../models/Account';
import { Program } from '../../../models/Program';
import { DailyBoardSnapshot } from '../../../models/DailyBoardSnapshot';
import { ProjectWeeklyReport } from '../../../models/ProjectWeeklyReport';
import { AccountWeeklyReport } from '../../../models/AccountWeeklyReport';
import { ProgramWeeklyReport } from '../../../models/ProgramWeeklyReport';
import { ProgramMonthlyReport } from '../../../models/ProgramMonthlyReport';
import { Op } from 'sequelize';
import { dsrJobId, weeklyJobId, accountWeeklyJobId, monthlyJobId } from '../../reports/queues/jobIds';
import { isAccountReportGenerationDay } from '../../reports/services/reportWindow';

export class SchedulerService {
    private job: schedule.Job | null = null;
    private dailyJob: schedule.Job | null = null;
    private weeklyJob: schedule.Job | null = null;
    private accountWeeklyJob: schedule.Job | null = null;
    private monthlyJob: schedule.Job | null = null;
    private perfSyncJob: schedule.Job | null = null;
    private programDailyJob: schedule.Job | null = null;
    private programWeeklyJob: schedule.Job | null = null;
    private programMonthlyJob: schedule.Job | null = null;

    start(): void {
        const cronExpression = config.scheduler.cronExpression;
        const weeklyCronExpression = config.scheduler.weeklyCronExpression;
        const accountWeeklyCronExpression = config.scheduler.accountWeeklyCronExpression;
        const monthlyCronExpression = config.scheduler.monthlyCronExpression;
        const programDailyCronExpression = config.scheduler.programDailyCronExpression;
        const programWeeklyCronExpression = config.scheduler.programWeeklyCronExpression;
        const programMonthlyCronExpression = config.scheduler.programMonthlyCronExpression;
        const timeZone = config.scheduler.timeZone;

        console.log(`Starting Scheduler...`);
        console.log(`Daily DSR Job planned for: ${cronExpression} (${timeZone})`);
        console.log(`Weekly Report Job planned for: ${weeklyCronExpression} (${timeZone}) — daily, per-account weekStartDay check`);
        console.log(`Account Weekly Report Job planned for: ${accountWeeklyCronExpression} (${timeZone}) — daily, per-account weekStartDay check`);
        console.log(`Monthly Report Job planned for: ${monthlyCronExpression} (Last day check enabled) (${timeZone})`);

        // Schedule Daily Job for ALL projects
        this.dailyJob = schedule.scheduleJob(
            { rule: cronExpression, tz: timeZone },
            async () => {
                console.log(`\n🕐 Daily DSR Job Triggered at ${new Date().toLocaleString('en-IN', { timeZone: timeZone })}`);
                await this.executeDailyJob();
            }
        );

        // Schedule Weekly Job for ALL projects (daily; each project's account is skipped unless
        // today is that account's configured weekStartDay — see processWeeklyProject)
        this.weeklyJob = schedule.scheduleJob(
            { rule: weeklyCronExpression, tz: timeZone },
            async () => {
                console.log(`\n📅 Weekly Report Job Triggered at ${new Date().toLocaleString('en-IN', { timeZone: timeZone })}`);
                await this.executeWeeklyJob();
            }
        );

        // Schedule Account Weekly Job for ALL accounts (daily; each account is skipped unless
        // today is its configured weekStartDay — see processWeeklyAccount)
        this.accountWeeklyJob = schedule.scheduleJob(
            { rule: accountWeeklyCronExpression, tz: timeZone },
            async () => {
                console.log(`\n🏢 Account Weekly Report Job Triggered at ${new Date().toLocaleString('en-IN', { timeZone: timeZone })}`);
                await this.executeAccountWeeklyJob();
            }
        );

        // Schedule Monthly Job for ALL projects (Last day of month 11PM IST)
        this.monthlyJob = schedule.scheduleJob(
            { rule: monthlyCronExpression, tz: timeZone },
            async () => {
                console.log(`\n📅 Monthly Report Job Triggered at ${new Date().toLocaleString('en-IN', { timeZone: timeZone })}`);
                await this.executeMonthlyJob();
            }
        );

        // Schedule Performance Sync Job — daily at 8AM IST to detect newly closed sprints.
        // 8AM gives the EOD-IST closeout window time to settle (was 2AM, but that ran
        // too close to last-day status flips and produced stale numbers).
        this.perfSyncJob = schedule.scheduleJob(
            { rule: '0 8 * * *', tz: timeZone },
            async () => {
                console.log(`\n🏆 Performance Sync Job Triggered at ${new Date().toLocaleString('en-IN', { timeZone: timeZone })}`);
                await this.executePerfSyncJob();
            }
        );

        // Program-level reports run AFTER their per-project / per-account source jobs finish, with ≥1h buffer
        // to absorb staggered processing time. All three are env-overridable.
        //   Daily program:    Mon-Fri 9:30 PM IST (1h 30m after Daily DSR at 8:00 PM)
        //   Weekly program:   daily 10:00 AM IST check (2h after Account Weekly's 8 AM check),
        //                     skipped unless today is that program's account's configured weekStartDay
        //   Monthly program:  1:00 AM IST on day 1-4, only when *yesterday* was the last day of its month
        console.log(`Program Daily Report Job planned for: ${programDailyCronExpression} (${timeZone})`);
        console.log(`Program Weekly Report Job planned for: ${programWeeklyCronExpression} (${timeZone})`);
        console.log(`Program Monthly Report Job planned for: ${programMonthlyCronExpression} (yesterday-was-last-day check) (${timeZone})`);

        this.programDailyJob = schedule.scheduleJob(
            { rule: programDailyCronExpression, tz: timeZone },
            async () => {
                console.log(`\n🧩 Program Daily Report Job Triggered at ${new Date().toLocaleString('en-IN', { timeZone: timeZone })}`);
                await this.executeProgramDailyJob();
            }
        );

        this.programWeeklyJob = schedule.scheduleJob(
            { rule: programWeeklyCronExpression, tz: timeZone },
            async () => {
                console.log(`\n🧩 Program Weekly Report Job Triggered at ${new Date().toLocaleString('en-IN', { timeZone: timeZone })}`);
                await this.executeProgramWeeklyJob();
            }
        );

        this.programMonthlyJob = schedule.scheduleJob(
            { rule: programMonthlyCronExpression, tz: timeZone },
            async () => {
                console.log(`\n🧩 Program Monthly Report Job Triggered at ${new Date().toLocaleString('en-IN', { timeZone: timeZone })}`);
                await this.executeProgramMonthlyJob();
            }
        );
    }

    async executeDailyJob(): Promise<void> {
        try {
            console.log('🚀 Starting Daily DSR Generation for all projects...');

            // Fetch all projects that have a Jira board configured
            const projects = await Project.findAll({
                where: {
                    jiraBoardId: { [Op.ne]: null },
                    isActive: true
                },
                include: [{ model: Account, attributes: ['name', 'code'] }]
            });

            if (projects.length === 0) {
                console.warn('⚠️ No projects with Jira board configuration found. Aborting job.');
                return;
            }

            console.log(`Found ${projects.length} projects to process.`);

            // Process concurrently
            // We use Promise.allSettled to ensure one failure doesn't stop others
            const results = await Promise.allSettled(
                projects.map((project, index) => this.processProject(project, index))
            );

            // Log Summary
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;

            console.log(`\n✅ Daily DSR Job Completed.`);
            console.log(`   Success: ${successful}`);
            console.log(`   Failed:  ${failed}`);

            if (failed > 0) {
                console.warn('⚠️ Some projects failed to generate reports. Check logs above.');
            }

        } catch (error) {
            console.error('❌ Error in daily DSR job:', error);
        }
    }

    async executeWeeklyJob(): Promise<void> {
        try {
            console.log('🚀 Starting Weekly Report Generation for all projects...');

            // Fetch all projects that have a Jira board configured
            const projects = await Project.findAll({
                where: {
                    jiraBoardId: { [Op.ne]: null },
                    isActive: true
                },
                include: [{ model: Account, attributes: ['name', 'code', 'weekStartDay'] }]
            });

            if (projects.length === 0) {
                console.warn('⚠️ No projects with Jira board configuration found. Aborting weekly job.');
                return;
            }

            console.log(`Found ${projects.length} projects to process for weekly reports.`);

            // Process with staged delays
            const results = await Promise.allSettled(
                projects.map((project, index) => this.processWeeklyProject(project, index))
            );

            // Log Summary
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;

            console.log(`\n✅ Weekly Report Job Completed.`);
            console.log(`   Success: ${successful}`);
            console.log(`   Failed:  ${failed}`);

            if (failed > 0) {
                console.warn('⚠️ Some projects failed to generate weekly reports. Check logs above.');
            }

        } catch (error) {
            console.error('❌ Error in weekly report job:', error);
        }
    }

    async executeAccountWeeklyJob(): Promise<void> {
        try {
            console.log('🚀 Starting Account Weekly Report Generation for all accounts...');

            // Fetch all accounts
            const accounts = await Account.findAll();

            if (accounts.length === 0) {
                console.warn('⚠️ No accounts found. Aborting account weekly job.');
                return;
            }

            console.log(`Found ${accounts.length} accounts to process for weekly summaries.`);

            // Process with staged delays (5 minutes per account as per plan)
            const results = await Promise.allSettled(
                accounts.map((account, index) => this.processWeeklyAccount(account, index))
            );

            // Log Summary
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;

            console.log(`\n✅ Account Weekly Report Job Completed.`);
            console.log(`   Success: ${successful}`);
            console.log(`   Failed:  ${failed}`);

            if (failed > 0) {
                console.warn('⚠️ Some accounts failed to generate weekly reports. Check logs above.');
            }

        } catch (error) {
            console.error('❌ Error in account weekly report job:', error);
        }
    }

    async executeMonthlyJob(): Promise<void> {
        try {
            if (!this.isLastDayOfMonth()) {
                console.log('🗓️  Monthly Scheduler: Today is not the last day of the month. Skipping execution.');
                return;
            }

            console.log('🚀 Starting Monthly Report Generation for all projects...');

            // Fetch all projects that have a Jira board configured
            const projects = await Project.findAll({
                where: {
                    jiraBoardId: { [Op.ne]: null },
                    isActive: true
                },
                include: [{ model: Account, attributes: ['name', 'code'] }]
            });

            if (projects.length === 0) {
                console.warn('⚠️ No projects with Jira board configuration found. Aborting monthly job.');
                return;
            }

            console.log(`Found ${projects.length} projects to process for monthly reports.`);

            // Process with staged delays (2 minutes per project)
            const results = await Promise.allSettled(
                projects.map((project, index) => this.processMonthlyProject(project, index))
            );

            // Log Summary
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;

            console.log(`\n✅ Monthly Report Job Completed.`);
            console.log(`   Success: ${successful}`);
            console.log(`   Failed:  ${failed}`);

            if (failed > 0) {
                console.warn('⚠️ Some projects failed to generate monthly reports. Check logs above.');
            }

        } catch (error) {
            console.error('❌ Error in monthly report job:', error);
        }
    }

    private async processProject(project: Project, index: number): Promise<void> {
        const accountName = (project as any).account?.code || 'Unknown';
        const logPrefix = `[${accountName}/${project.code}]`;
        try {
            const todayStr = this.getISTDateStr(); // YYYY-MM-DD
            console.log(`${logPrefix} Checking status for ${todayStr}...`);

            // Configured IST window start in UTC (IST = UTC + 5:30)
            const cutoffDateUTC = new Date();
            cutoffDateUTC.setUTCHours(
                config.reports.windowStartHour - 5,
                config.reports.windowStartMinute - 30,
                0,
                0
            );

            // Find existing snapshot for today
            const snapshot = await DailyBoardSnapshot.findOne({
                where: {
                    projectId: project.id,
                    date: todayStr
                }
            });

            if (snapshot) {
                const recordTime = snapshot.createdAt;

                if (recordTime >= cutoffDateUTC) {
                    console.log(`${logPrefix} ⏭️  Valid report exists (Created: ${recordTime.toISOString()} >= Cutoff: ${cutoffDateUTC.toISOString()}). Skipping.`);
                    return;
                } else {
                    console.log(`${logPrefix} ⚠️  Report exists but created BEFORE cutoff (${recordTime.toISOString()} < ${cutoffDateUTC.toISOString()}). Regenerating...`);
                }
            } else {
                console.log(`${logPrefix} 📝 No report found for today. Generating...`);
            }

            // Enqueue Job with offset delay
            const delay = index * 60000; // 1-minute delay per project iteration
            const { dsrQueue } = require('../../reports/queues/dsrQueue');
            // jobId dedupes the identical enqueue from every other PM2 cluster instance —
            // all of them run this same cron. No remove() here: dropping the duplicate is the point.
            await dsrQueue.add('generate-dsr', {
                projectName: project.code,
                date: undefined
            }, {
                delay: delay,
                jobId: dsrJobId(project.code, todayStr)
            });
            console.log(`${logPrefix} ✅ Daily Job queued successfully with a ${delay / 1000}s stagger offset.`);

        } catch (error: any) {
            console.error(`${logPrefix} ❌ Failed to process daily report: ${error.message}`);
            throw error;
        }
    }

    /**
     * True when a report already exists for the period AND was generated after that
     * period closed — meaning it cannot be missing any of the period's data.
     *
     * Queue workers always pass `force=true`, so the service-level cache check is
     * unreachable from a scheduled job: without a guard here, every cron fire rebuilds
     * a report that may already be complete. The daily DSR path has always had such a
     * guard (see `processProject`); the rollup paths did not.
     *
     * Deliberately conservative. A report created mid-period is treated as stale and
     * still regenerated, so the scheduler keeps its role as the safety net — this only
     * suppresses the case where a *complete* report already exists, typically a manual
     * generation that beat the cron.
     *
     * Only applied to rollups whose cron fires after their period has closed. The
     * project-monthly and program-daily crons fire *during* their period, so no
     * pre-existing report can be complete and a check there would never skip.
     */
    private async hasCompleteReport(
        model: { findOne(options: any): Promise<any> },
        where: Record<string, unknown>,
        periodEndIsoDate: string,
        logPrefix: string,
        label: string
    ): Promise<boolean> {
        try {
            const existing = await model.findOne({ where });
            if (!existing) return false;

            const createdAt: Date | undefined = (existing as any).createdAt;
            if (!createdAt) return false;

            // The period closes at the end of its final IST day.
            const periodClose = new Date(`${periodEndIsoDate}T23:59:59.999+05:30`);
            if (new Date(createdAt) > periodClose) {
                console.log(
                    `${logPrefix} ⏭️  Complete ${label} already exists (created ${new Date(createdAt).toISOString()} > period close ${periodClose.toISOString()}). Skipping.`
                );
                return true;
            }
            console.log(
                `${logPrefix} ⚠️  ${label} exists but was created before the period closed. Regenerating...`
            );
            return false;
        } catch (error: any) {
            // Never let the guard itself stop a report being produced — on any doubt,
            // fall through and enqueue exactly as before.
            console.warn(`${logPrefix} Could not check for an existing ${label}, enqueuing anyway: ${error.message}`);
            return false;
        }
    }

    private async processWeeklyProject(project: Project, index: number): Promise<void> {
        const accountName = (project as any).account?.code || 'Unknown';
        const logPrefix = `[${accountName}/${project.code}]`;
        try {
            // Cron now fires daily (see start()); only proceed for this project's account on the
            // one day per week that matches its configured weekStartDay (default 5=Friday --
            // byte-identical to the old Friday-only cron for every account that hasn't changed
            // this setting). This is the day the *new* week begins, i.e. the morning after the
            // just-completed week's last day, matching the old system's exact timing.
            const weekStartDay: number = (project as any).account?.weekStartDay ?? 5;
            const istToday = this.getISTDate();
            if (!isAccountReportGenerationDay(weekStartDay, istToday)) {
                console.log(`${logPrefix} ⏭️  Not this account's configured report-generation day today (weekStartDay=${weekStartDay}). Skipping.`);
                return;
            }

            // Enqueue Weekly Job with offset delay (2-minute delay per project as requested/planned)
            const delay = index * 120000; // 2-minute delay (120,000ms)

            const { weeklyReportQueue } = require('../../reports/queues/weeklyReportQueue');

            // Today is confirmed to be this account's report-generation day, so the just-completed
            // week ended yesterday: window is [today - 7 days, today - 1 day].
            const endIST = new Date(istToday);
            endIST.setDate(istToday.getDate() - 1);
            const startIST = new Date(endIST);
            startIST.setDate(endIST.getDate() - 6);
            const fmtIST = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
            const startDate = fmtIST(startIST);
            const endDate = fmtIST(endIST);

            if (await this.hasCompleteReport(
                ProjectWeeklyReport,
                { projectId: project.id, startDate, endDate },
                endDate,
                logPrefix,
                'weekly report'
            )) return;

            await weeklyReportQueue.add('generate-weekly-report', {
                projectName: project.code,
                startDate,
                endDate
            }, {
                delay: delay,
                jobId: weeklyJobId(project.code, startDate)
            });

            console.log(`${logPrefix} ✅ Weekly Job queued successfully with a ${delay / 1000}s stagger offset.`);

        } catch (error: any) {
            console.error(`${logPrefix} ❌ Failed to process weekly report: ${error.message}`);
            throw error;
        }
    }

    private async processWeeklyAccount(account: Account, index: number): Promise<void> {
        const logPrefix = `[Account: ${account.code}]`;
        try {
            // Cron now fires daily (see start()); only proceed for this account on the one day
            // per week that matches its configured weekStartDay (default 5=Friday --
            // byte-identical to the old Friday-only cron for every account that hasn't changed
            // this setting). This is the day the *new* week begins, i.e. the morning after the
            // just-completed week's last day, matching the old system's exact timing.
            const weekStartDay = account.weekStartDay ?? 5;
            const istToday = this.getISTDate();
            if (!isAccountReportGenerationDay(weekStartDay, istToday)) {
                console.log(`${logPrefix} ⏭️  Not this account's configured report-generation day today (weekStartDay=${weekStartDay}). Skipping.`);
                return;
            }

            // Enqueue Account Weekly Job with offset delay (5-minute delay per account as per plan)
            const delay = index * 300000; // 5-minute delay (300,000ms)

            const { accountReportQueue } = require('../../reports/queues/accountReportQueue');

            // Today is confirmed to be this account's report-generation day, so the just-completed
            // week ended yesterday: window is [today - 7 days, today - 1 day].
            const endIST = new Date(istToday);
            endIST.setDate(istToday.getDate() - 1);
            const startIST = new Date(endIST);
            startIST.setDate(endIST.getDate() - 6);
            const fmtIST = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
            const startDate = fmtIST(startIST);
            const endDate = fmtIST(endIST);

            if (await this.hasCompleteReport(
                AccountWeeklyReport,
                { accountId: account.id, startDate, endDate },
                endDate,
                logPrefix,
                'account weekly report'
            )) return;

            await accountReportQueue.add('generate-account-report', {
                accountId: account.id,
                startDate,
                endDate
            }, {
                delay: delay,
                jobId: accountWeeklyJobId(account.id, startDate)
            });

            console.log(`${logPrefix} ✅ Account Weekly Job queued successfully with a ${delay / 1000}s stagger offset.`);

        } catch (error: any) {
            console.error(`${logPrefix} ❌ Failed to process account weekly report: ${error.message}`);
            throw error;
        }
    }

    private async processMonthlyProject(project: Project, index: number): Promise<void> {
        const accountName = (project as any).account?.code || 'Unknown';
        const logPrefix = `[${accountName}/${project.code}]`;
        try {
            // Enqueue Monthly Job with offset delay (2-minute delay per project)
            const delay = index * 120000; // 2-minute delay (120,000ms)

            const { monthlyReportQueue } = require('../../reports/queues/monthlyReportQueue');

            const now = this.getISTDate();
            const month = now.getMonth() + 1; // 1-12
            const year = now.getFullYear();

            await monthlyReportQueue.add('monthly-report-generation', {
                projectId: project.id,
                month: month,
                year: year
            }, {
                delay: delay,
                jobId: monthlyJobId(project.id, month, year)
            });

            console.log(`${logPrefix} ✅ Monthly Job queued successfully with a ${delay / 1000}s stagger offset for ${month}/${year}.`);

        } catch (error: any) {
            console.error(`${logPrefix} ❌ Failed to process monthly report: ${error.message}`);
            throw error;
        }
    }

    /**
     * Fetch programs that have at least one assigned project. Empty programs are skipped
     * so we don't generate 422-only failed jobs.
     */
    private async fetchNonEmptyPrograms(): Promise<Program[]> {
        return Program.findAll({
            include: [
                { model: Project, attributes: ['id'], required: true },
                { model: Account, attributes: ['weekStartDay'] }
            ],
            order: [['accountId', 'ASC'], ['name', 'ASC']],
        });
    }

    async executeProgramDailyJob(): Promise<void> {
        try {
            const programs = await this.fetchNonEmptyPrograms();
            if (programs.length === 0) {
                console.warn('⚠️ No non-empty programs found. Skipping Program Daily job.');
                return;
            }
            console.log(`Found ${programs.length} non-empty programs for Program Daily reports.`);
            const results = await Promise.allSettled(
                programs.map((p, i) => this.processProgramDaily(p, i))
            );
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            console.log(`\n✅ Program Daily Job Completed.   Success: ${successful}   Failed: ${failed}`);
        } catch (error) {
            console.error('❌ Error in Program Daily job:', error);
        }
    }

    async executeProgramWeeklyJob(): Promise<void> {
        try {
            const programs = await this.fetchNonEmptyPrograms();
            if (programs.length === 0) {
                console.warn('⚠️ No non-empty programs found. Skipping Program Weekly job.');
                return;
            }
            console.log(`Found ${programs.length} non-empty programs for Program Weekly reports.`);
            const results = await Promise.allSettled(
                programs.map((p, i) => this.processProgramWeekly(p, i))
            );
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            console.log(`\n✅ Program Weekly Job Completed.   Success: ${successful}   Failed: ${failed}`);
        } catch (error) {
            console.error('❌ Error in Program Weekly job:', error);
        }
    }

    async executeProgramMonthlyJob(): Promise<void> {
        try {
            // Cron fires on day 1-4 at 1 AM IST as a buffer; only proceed when *yesterday* was the
            // last day of its month (i.e. today is the 1st). Project monthly ran the prior evening
            // at 11 PM IST so its rollup data is already populated.
            if (!this.wasYesterdayLastDayOfMonth()) {
                console.log('🗓️  Program Monthly Scheduler: Yesterday was not the last day of a month. Skipping.');
                return;
            }
            const programs = await this.fetchNonEmptyPrograms();
            if (programs.length === 0) {
                console.warn('⚠️ No non-empty programs found. Skipping Program Monthly job.');
                return;
            }
            console.log(`Found ${programs.length} non-empty programs for Program Monthly reports.`);
            const results = await Promise.allSettled(
                programs.map((p, i) => this.processProgramMonthly(p, i))
            );
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            console.log(`\n✅ Program Monthly Job Completed.   Success: ${successful}   Failed: ${failed}`);
        } catch (error) {
            console.error('❌ Error in Program Monthly job:', error);
        }
    }

    private async processProgramDaily(program: Program, index: number): Promise<void> {
        const logPrefix = `[Program: ${program.name} (${program.id})]`;
        try {
            const date = this.getISTDateStr();
            const delay = index * 60000; // 1 min stagger
            const { programDailyReportQueue } = require('../../reports/queues/programDailyReportQueue');
            await programDailyReportQueue.add(
                'generate',
                { programId: program.id, date },
                { delay, jobId: `program-daily-${program.id}-${date}` }
            );
            console.log(`${logPrefix} ✅ Program Daily Job queued (${delay / 1000}s offset) for ${date}.`);
        } catch (error: any) {
            console.error(`${logPrefix} ❌ Failed to enqueue daily report: ${error.message}`);
            throw error;
        }
    }

    private async processProgramWeekly(program: Program, index: number): Promise<void> {
        const logPrefix = `[Program: ${program.name} (${program.id})]`;
        try {
            // Cron now fires daily (see start()); only proceed for this program's account on the
            // one day per week that matches its configured weekStartDay (default 5=Friday --
            // byte-identical to the old Friday-only cron for every account that hasn't changed
            // this setting). This is the day the *new* week begins, i.e. the morning after the
            // just-completed week's last day, matching the old system's exact timing.
            const weekStartDay: number = (program as any).account?.weekStartDay ?? 5;
            const istToday = this.getISTDate();
            if (!isAccountReportGenerationDay(weekStartDay, istToday)) {
                console.log(`${logPrefix} ⏭️  Not this program's account's configured report-generation day today (weekStartDay=${weekStartDay}). Skipping.`);
                return;
            }

            // Today is confirmed to be this account's report-generation day, so the just-completed
            // week ended yesterday: window is [today - 7 days, today - 1 day].
            const endIST = new Date(istToday);
            endIST.setDate(istToday.getDate() - 1);
            const startIST = new Date(endIST);
            startIST.setDate(endIST.getDate() - 6);
            const fmtIST = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
            const startDate = fmtIST(startIST);
            const endDate = fmtIST(endIST);

            if (await this.hasCompleteReport(
                ProgramWeeklyReport,
                { programId: program.id, startDate, endDate },
                endDate,
                logPrefix,
                'program weekly report'
            )) return;

            const delay = index * 120000; // 2 min stagger
            const { programWeeklyReportQueue } = require('../../reports/queues/programWeeklyReportQueue');
            await programWeeklyReportQueue.add(
                'generate',
                { programId: program.id, startDate, endDate },
                { delay, jobId: `program-weekly-${program.id}-${startDate}` }
            );
            console.log(`${logPrefix} ✅ Program Weekly Job queued (${delay / 1000}s offset) for ${startDate}..${endDate}.`);
        } catch (error: any) {
            console.error(`${logPrefix} ❌ Failed to enqueue weekly report: ${error.message}`);
            throw error;
        }
    }

    private async processProgramMonthly(program: Program, index: number): Promise<void> {
        const logPrefix = `[Program: ${program.name} (${program.id})]`;
        try {
            // Cron fires shortly after midnight IST on day 1, so the month we want to roll up is
            // *yesterday's* month (the one that just ended), not today's.
            const yesterday = this.getYesterdayIST();
            const month = yesterday.getMonth() + 1;
            const year = yesterday.getFullYear();

            // The guard above establishes that yesterday was the last day of `month`,
            // so it is exactly this period's closing date.
            const periodEnd = yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
            if (await this.hasCompleteReport(
                ProgramMonthlyReport,
                { programId: program.id, month, year },
                periodEnd,
                logPrefix,
                'program monthly report'
            )) return;

            const delay = index * 120000; // 2 min stagger
            const { programMonthlyReportQueue } = require('../../reports/queues/programMonthlyReportQueue');
            await programMonthlyReportQueue.add(
                'generate',
                { programId: program.id, month, year },
                { delay, jobId: `program-monthly-${program.id}-${year}-${month}` }
            );
            console.log(`${logPrefix} ✅ Program Monthly Job queued (${delay / 1000}s offset) for ${month}/${year}.`);
        } catch (error: any) {
            console.error(`${logPrefix} ❌ Failed to enqueue monthly report: ${error.message}`);
            throw error;
        }
    }

    private isLastDayOfMonth(): boolean {
        const now = this.getISTDate();
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        return tomorrow.getDate() === 1;
    }

    private wasYesterdayLastDayOfMonth(): boolean {
        return this.getISTDate().getDate() === 1;
    }

    private getYesterdayIST(): Date {
        const y = this.getISTDate();
        y.setDate(y.getDate() - 1);
        return y;
    }

    private getISTDate(): Date {
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        return new Date(utc + (330 * 60000));
    }

    private getISTDateStr(): string {
        return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
    }


    async executePerfSyncJob(): Promise<void> {
        try {
            const { performanceSyncService } = require('../../../modules/reports/services/performanceSyncService');
            await performanceSyncService.detectAndEnqueueNewlyClosed();
            console.log('Performance sync detection complete.');
        } catch (error) {
            console.error('Error in performance sync detection job:', error);
        }
    }

    stop(): void {
        if (this.job) this.job.cancel();
        if (this.dailyJob) this.dailyJob.cancel();
        if (this.weeklyJob) this.weeklyJob.cancel();
        if (this.accountWeeklyJob) this.accountWeeklyJob.cancel();
        if (this.monthlyJob) this.monthlyJob.cancel();
        if (this.perfSyncJob) this.perfSyncJob.cancel();
        if (this.programDailyJob) this.programDailyJob.cancel();
        if (this.programWeeklyJob) this.programWeeklyJob.cancel();
        if (this.programMonthlyJob) this.programMonthlyJob.cancel();
        console.log('Scheduler stopped');
    }

    private extractProjectFromSprint(sprintName: string): string | null {
        const match = sprintName.match(/^([A-Z]+)/);
        return match ? match[1] : null;
    }
}

export const schedulerService = new SchedulerService();

