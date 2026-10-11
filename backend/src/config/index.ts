import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

export const config = {
    reports: {
        path: process.env.REPORTS_PATH
            ? path.resolve(process.env.REPORTS_PATH)
            : path.join(__dirname, '../../../reports'),
        windowStartHour: parseInt(process.env.REPORT_WINDOW_START_HOUR || '20'),
        windowStartMinute: parseInt(process.env.REPORT_WINDOW_START_MINUTE || '0'),
    },
    uploads: {
        // Every uploaded Excel/CSV file is retained here, one file per import, so users can
        // download exactly what they submitted and resubmit it after a mapping change.
        // Must be a persistent volume in production -- process.cwd() does not survive a redeploy.
        path: process.env.UPLOAD_PATH
            ? path.resolve(process.env.UPLOAD_PATH)
            : path.join(__dirname, '../../../uploads'),
    },
    jira: {
        baseUrl: process.env.JIRA_BASE_URL || '',
        boardIds: process.env.JIRA_BOARD_IDS
            ? process.env.JIRA_BOARD_IDS.split(',').map(id => parseInt(id.trim()))
            : [],
        sprintNames: process.env.JIRA_SPRINT_NAMES
            ? process.env.JIRA_SPRINT_NAMES.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''))
            : [],

        includeBacklog: process.env.JIRA_INCLUDE_BACKLOG === 'true',
        defaultLaneConfig: (() => {
            try {
                const raw = process.env.DEFAULT_JIRA_LANE_CONFIG;
                return raw ? JSON.parse(raw) : null;
            } catch {
                return null;
            }
        })(),
    },
    postgres: {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'jira_daily_reports',
        port: parseInt(process.env.DB_PORT || '5432'),
    },
    anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY || '',
    },
    // Claude usage collector — the machine agent pushes content-free metrics here.
    // Cost is computed SERVER-SIDE from this single pricing table (the collector
    // never sends money), so a rate change is a one-line edit here.
    collector: {
        // Secret mixed into the SHA-256 of ingest tokens before storage/compare.
        tokenPepper: process.env.COLLECTOR_TOKEN_PEPPER || 'change-me-collector-pepper',
        // Bumping this invalidates prior consent and forces re-consent in the UI.
        consentVersion: process.env.COLLECTOR_CONSENT_VERSION || '1.0',
        // USD per 1,000,000 tokens, per model, per tier. Estimates — edit freely.
        pricing: {
            'claude-opus-4-8': { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.5 },
            'claude-opus-4-7': { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.5 },
            'claude-opus-4-6': { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.5 },
            'claude-opus-4-5': { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.5 },
            'claude-sonnet-5': { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
            'claude-sonnet-4-6': { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
            'claude-sonnet-4-5': { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
            'claude-haiku-4-5': { input: 1.0, output: 5.0, cache_write: 1.25, cache_read: 0.1 },
            'claude-fable-5': { input: 10.0, output: 50.0, cache_write: 12.5, cache_read: 1.0 },
        } as Record<string, { input: number; output: number; cache_write: number; cache_read: number }>,
        fallbackPrice: { input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.5 },
        // Score bands (applied to the collector's Good/OK/Poor tallies).
        thresholds: { good: 70, ok: 40 },
        // License/benchmark model for the VALUE view (see claudeUsageReportService).
        // Teams are on a corporate seat/subscription license, so the API list-price
        // dollar figure is NOT a bill — it's the "value" this usage would cost at API
        // prices. We compare that to a seat cost to show leverage (ROI), not spend.
        // The real per-customer seat price is usually unknown (it's the customer's
        // account) and this platform is multi-customer, so this is a documented
        // BENCHMARK/ASSUMPTION — admins can override per org in Admin > Monitored Orgs.
        defaultLicenseType: (process.env.COLLECTOR_DEFAULT_LICENSE_TYPE || 'seat') as 'seat' | 'api',
        defaultSeatMonthlyUsd: Number(process.env.COLLECTOR_DEFAULT_SEAT_MONTHLY_USD || '100'),
        // Integrity thresholds (ADDENDUM 5). Since the collector is self-reported from a
        // user-controlled machine, we can't PREVENT tampering — only detect + deter. Hard
        // invariants (arithmetic identities) reject impossible rows; these bands only FLAG
        // implausible-but-valid rows for admin review (never block). Tunable, not law.
        integrity: {
            minTokensPerPrompt: 30, // fewer than this with real prompts is implausible
            maxTokensPerPrompt: 80_000_000, // more than this per prompt is implausible
            perfectScore: 95, // avg score at/above this…
            perfectScoreMinScored: 20, // …with at least this many scored prompts → flag
            regimeScoreJump: 40, // avg-score jump vs trailing median → flag
            regimeTokenFactor: 12, // token volume ≥ this × trailing median → flag
            // Every release the server recognises. A version missing here is not
            // rejected, only flagged 'unknown-collector' in Data Quality — which is
            // how 1.3.0 went unlisted for a fortnight after its release.
            knownCollectorVersions: ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.4.1', '1.4.2', '1.4.3', '1.4.4', '1.5.0', '1.5.1', '1.5.2'],
        },
        // When true, ingest requires an org uuid that is on the monitored-org
        // allowlist (multi-customer scoping). A push with no org (API-key mode)
        // or an unenabled org is rejected. Set false to accept org-less data.
        requireOrg: (process.env.COLLECTOR_REQUIRE_ORG || 'true').toLowerCase() === 'true',
        // NOTE: there is deliberately no `currentVersion` here. The release being
        // served is read from collector.js itself — see
        // collectorAuthService.currentCollectorVersion. A constant here would be a
        // second copy that drifts silently the moment COLLECTOR_VERSION is bumped.
        //
        // How many days without ANY contact (lastSeenAt on the ingest token, stamped
        // on every request that reaches us — even a rejected or rate-limited one)
        // before an install is flagged stale in Admin > Installs. This is the
        // server-side safety net for whatever the client-side VPN check can't catch:
        // if the gate is stuck treating a machine as permanently on VPN, nothing
        // reaches the server at all, and this is what makes that visible to a human
        // rather than silent. Same signal also catches "on leave" or "collector
        // crashed" — deliberately: a human decides what to do about it, not the system.
        staleAfterDays: process.env.COLLECTOR_STALE_AFTER_DAYS
            ? parseInt(process.env.COLLECTOR_STALE_AFTER_DAYS, 10) : 5,
        // Folder streamed (as a zip) to engineers by the in-UI "Download collector"
        // button. Defaults to the repo's tools/claude-usage-collector.
        sourceDir: process.env.COLLECTOR_SOURCE_DIR
            ? path.resolve(process.env.COLLECTOR_SOURCE_DIR)
            : path.join(__dirname, '../../../tools/claude-usage-collector'),
    },
    scheduler: {
        cronExpression: process.env.CRON_EXPRESSION || '0 20 * * 1-5',
        // Daily, not Friday-only: each account now has its own configurable weekStartDay
        // (default Friday), so the weekly jobs must check every account every day and only
        // generate on that account's actual configured report-generation day -- the day its new
        // week begins, i.e. the morning after its previous week closed (see schedulerService.ts's
        // processWeeklyProject/processWeeklyAccount/processProgramWeekly and
        // isAccountReportGenerationDay). For every account still on the default (Friday), this
        // fires the exact same real work on the exact same day as before.
        weeklyCronExpression: process.env.WEEKLY_CRON_EXPRESSION || '0 6 * * *',
        accountWeeklyCronExpression: process.env.ACCOUNT_WEEKLY_CRON_EXPRESSION || '0 8 * * *',
        monthlyCronExpression: process.env.MONTHLY_CRON_EXPRESSION || '0 23 28-31 * *',
        programDailyCronExpression: process.env.PROGRAM_DAILY_CRON_EXPRESSION || '30 21 * * 1-5',
        programWeeklyCronExpression: process.env.PROGRAM_WEEKLY_CRON_EXPRESSION || '0 10 * * *',
        programMonthlyCronExpression: process.env.PROGRAM_MONTHLY_CRON_EXPRESSION || '0 1 1-4 * *',
        timeZone: process.env.SCHEDULER_TIMEZONE || 'Asia/Kolkata'
    },
    server: {
        port: parseInt(process.env.PORT || '3000'),
    },
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
    },
    logging: {
        level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG')
    },
    email: {
        senderName: process.env.EMAIL_SENDER_NAME || '',
        senderAddress: process.env.EMAIL_SENDER_ADDRESS || '',
        defaultCc: process.env.EMAIL_DEFAULT_CC || '',
    },
    notifications: {
        enabled: (process.env.NOTIFICATIONS_ENABLED || 'true').toLowerCase() === 'true',
        provider: (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase() as 'sendgrid' | 'smtp',
        fromName: process.env.EMAIL_FROM_NAME || process.env.EMAIL_SENDER_NAME || 'Lens Notifications',
        fromAddress: process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_SENDER_ADDRESS || '',
        sendgrid: {
            apiKey: process.env.SENDGRID_API_KEY || '',
        },
        smtp: {
            host: process.env.SMTP_HOST || '',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
            user: process.env.SMTP_USER || '',
            pass: process.env.SMTP_PASS || '',
        },
    },
    environment: process.env.NODE_ENV || 'development',
};
