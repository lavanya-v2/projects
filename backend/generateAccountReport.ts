import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import sequelize from './src/config/connection';
import { Account } from './src/models/Account';
import * as fs from 'fs';
import * as path from 'path';
import { rollupAccountRange } from './src/modules/reports/services/rangeRollupService';
import { aiService } from './src/modules/ai/services/aiService';
import { normalizeWindow } from './src/modules/reports/services/reportWindow';

// Phase 4 of the RAG-reliability plan: this script used to re-implement its own project
// rollup (no isActive filter, latestHealth-only) and call the Anthropic SDK directly with its
// own copy of the prompt. Both now come from the same shared code the app uses
// (rangeRollupService, aiService.generateRangeAccountBriefing), so a number here and the same
// number in Lens for the same window are computed by the identical function, not two
// hand-maintained copies that can silently drift. Account health is deterministic
// (rollup.deterministicHealth) — the AI narrates around it, never decides it.
//
// Also absorbs generateRangeAccountReport.ts, which was a 22-line diff of this file adding
// only a --label option and a different output filename — collapsed here via --label and
// --filename-mode rather than kept as a second near-identical file.

function validateDateFormat(dateStr: string, label: string): void {
    if (!/^\d{8}$/.test(dateStr)) {
        throw new Error(`${label} must be exactly 8 digits in DDMMYYYY format. Got: "${dateStr}"`);
    }
    const day = parseInt(dateStr.slice(0, 2), 10);
    const month = parseInt(dateStr.slice(2, 4), 10);
    const year = parseInt(dateStr.slice(4, 8), 10);

    if (month < 1 || month > 12) throw new Error(`${label} has invalid month ${month}.`);
    if (day < 1 || day > 31) throw new Error(`${label} has invalid day ${day}.`);

    const parsed = new Date(year, month - 1, day);
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
        throw new Error(`${label} is not a valid calendar date: ${dateStr}`);
    }
}

function parseDDMMYYYY(dateStr: string): string {
    const day = dateStr.slice(0, 2);
    const month = dateStr.slice(2, 4);
    const year = dateStr.slice(4, 8);
    return `${year}-${month}-${day}`;
}

function formatReport(
    accountName: string,
    startDateStr: string,
    endDateStr: string,
    label: string,
    deterministicHealth: string,
    projects: Array<{ code: string; name: string; latestHealth: string; worstHealth: string; deterministicHealth: string }>,
    briefing: {
        executiveSummary: string;
        healthExplanation: string;
        projectHighlights: string;
        accountRisks: string;
        projectRisks: string;
        recommendedActions: string;
    }
): string {
    const projectTable = projects.map(r =>
        `  - ${r.code.padEnd(10)} ${r.deterministicHealth.padEnd(7)} (latest day: ${r.latestHealth}, worst day: ${r.worstHealth})  ${r.name}`
    ).join('\n') || '  (no projects with data in this window)';

    return `============================================================
${label.toUpperCase()}: ${accountName}
Period: ${startDateStr} to ${endDateStr}
Audience: Senior Management
============================================================

EXECUTIVE SUMMARY
-----------------
${briefing.executiveSummary}

ACCOUNT HEALTH: ${deterministicHealth}
-----------------
${briefing.healthExplanation}

PROJECT SNAPSHOT
----------------
${projectTable}

PROJECT HIGHLIGHTS
------------------
${briefing.projectHighlights}

ACCOUNT-LEVEL RISKS
-------------------
${briefing.accountRisks}

PROJECT-SPECIFIC RISKS
----------------------
${briefing.projectRisks}

RECOMMENDED ACTIONS
-------------------
${briefing.recommendedActions}
`;
}

async function generateReport(accountName: string, startDateStr: string, endDateStr: string, label: string, filenameMode: string) {
    console.log(`Starting Account Report Generation`);
    console.log(`Account: ${accountName}, Window: ${startDateStr} to ${endDateStr}, Label: "${label}"`);

    let hasErrors = false;

    try {
        validateDateFormat(startDateStr, 'start-date');
        validateDateFormat(endDateStr, 'end-date');

        const startDate = parseDDMMYYYY(startDateStr);
        const endDate = parseDDMMYYYY(endDateStr);
        const window = normalizeWindow(startDate, endDate, 'arbitrary');

        await sequelize.authenticate();
        console.log('Connected to Database.');

        const { Op } = require('sequelize');
        const account = await Account.findOne({
            where: { name: { [Op.iLike]: `%${accountName}%` } }
        });

        if (!account) {
            console.error(`Account matching '${accountName}' not found.`);
            process.exit(1);
        }
        console.log(`Found Account: ${account.name} (ID: ${account.id})`);

        // Phase B (weekly stabilization): when the requested window is exactly one Friday-Thursday
        // reporting week, read each project's already-generated ProjectWeeklyReport (the same
        // source of truth the app's own account report already reads) instead of independently
        // recomputing from raw daily snapshots — so this script and the app agree on the same
        // week, instead of silently disagreeing whenever a cached weekly report has gone stale
        // relative to the snapshots underneath it. Falls back to the original snapshot-based
        // rollup for any window that isn't a single complete Fri-Thu week (multi-week or ad-hoc
        // ranges), where 'weekly-reports' isn't valid (see rangeRollupService.ts's own contract).
        let isExactFriThuWeek = true;
        try {
            normalizeWindow(window.startDate, window.endDate, 'fri-thu-week');
        } catch {
            isExactFriThuWeek = false;
        }
        const rollup = await rollupAccountRange(
            account.id,
            { startDate: window.startDate, endDate: window.endDate },
            isExactFriThuWeek ? { source: 'weekly-reports' } : {}
        );

        for (const p of rollup.projects) {
            console.log(`  - ${p.code}: ${p.snapshotCount} snapshots, deterministic=${p.deterministicHealth}, latest=${p.latestHealth}, worst=${p.worstHealth}`);
        }
        for (const name of rollup.projectsMissing) {
            console.log(`  - ${name}: no snapshots in window (missing)`);
        }

        if (rollup.projects.length === 0) {
            console.error('No project data available in the given window. Aborting.');
            process.exit(1);
        }

        console.log(`Found ${rollup.risks.length} relevant risks for the account.`);
        console.log(`Deterministic account health: ${rollup.deterministicHealth}`);

        console.log('Calling AI to generate senior-management briefing...');
        const briefing = await aiService.generateRangeAccountBriefing(rollup, { label });

        const { temporalValidator } = require('./src/common/utils');
        const validation = temporalValidator.validateTemporalClaims(
            JSON.stringify(briefing),
            `RangeAccount-${account.name}`
        );
        if (!validation.isValid || validation.suspiciousClaims.length > 0) {
            console.warn(`Temporal validation warnings: ${temporalValidator.generateValidationReport(validation)}`);
        }

        const reportText = formatReport(account.name, startDateStr, endDateStr, label, rollup.deterministicHealth, rollup.projects, briefing);

        const outputDirName = `${startDateStr}_to_${endDateStr}`;
        const rootDir = path.resolve(__dirname, '../');
        const reportsDir = path.join(rootDir, 'reports', 'account_summaries', outputDirName);
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        const safeName = account.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = filenameMode === 'start-end'
            ? `${safeName}_${startDateStr}_to_${endDateStr}.txt`
            : `${safeName}_${endDateStr}.txt`;
        const filePath = path.join(reportsDir, fileName);
        fs.writeFileSync(filePath, reportText);
        console.log(`Report saved to: ${filePath}`);

        // aiService.generateRangeAccountBriefing calls recordAiUsage, which is deliberately
        // fire-and-forget (a live web request must never block on usage bookkeeping) — but this
        // script calls process.exit() right after this block, which would otherwise kill the
        // process before that background write lands. A short pause lets it flush.
        await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
        console.error('Fatal Script Error:', error);
        hasErrors = true;
    } finally {
        await sequelize.close();
        process.exit(hasErrors ? 1 : 0);
    }
}

const argv = yargs(hideBin(process.argv))
    .option('account', {
        type: 'string',
        demandOption: true,
        description: 'Account base name to generate for'
    })
    .option('start-date', {
        type: 'string',
        demandOption: true,
        description: 'Start date in DDMMYYYY format'
    })
    .option('end-date', {
        type: 'string',
        demandOption: true,
        description: 'End date in DDMMYYYY format'
    })
    .option('label', {
        type: 'string',
        default: 'Account Report',
        description: 'Label used in the report heading and prompt intro (e.g. "Monthly Account Summary", "Q3 2026 Executive Briefing"). Default: "Account Report"'
    })
    .option('filename-mode', {
        type: 'string',
        default: 'end',
        choices: ['end', 'start-end'],
        description: '"end" = <account>_<endDate>.txt (default, twice-weekly convention); "start-end" = <account>_<startDate>_to_<endDate>.txt'
    })
    .parseSync();

generateReport(argv.account, argv['start-date'], argv['end-date'], argv.label, argv['filename-mode']);
