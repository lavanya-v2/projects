import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import sequelize from './src/config/connection';
import { Account } from './src/models/Account';
import { Project } from './src/models/Project';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { rollupProjectRange, ProjectRangeRollup } from './src/modules/reports/services/rangeRollupService';
import { aiService } from './src/modules/ai/services/aiService';
import { normalizeWindow } from './src/modules/reports/services/reportWindow';
import { config } from './src/config';
import { escapeHtml, buildEmlContent } from './src/common/emlBuilder';

// Phase 4 of the RAG-reliability plan: this script used to fetch DailyBoardSnapshot rows and
// build its own AI prompt directly against the Anthropic SDK. Both now come from the shared
// rangeRollupService / aiService.generateRangeProjectSummary the app itself uses, so this
// script's numbers agree with Lens for the same window instead of drifting from a second,
// hand-maintained copy of the rollup logic.
//
// Also absorbs generateRangeReport.ts, which was an 87-line diff of this file adding only a
// --label option (swapping the "next report" line for an explicit date range in the subject
// and intro) — collapsed here via --label instead of kept as a second near-identical file.
// generateTwiceWeeklyReports.ts (a third, stale near-clone with an older 6-rule prompt and a
// plain-text "Sprint Board View" section) is deleted outright: its prompt is superseded by the
// one now shared via aiService, and its board-view section had no other caller.

const MAX_CONCURRENCY = 3;

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const STATUS_COLORS: Record<string, string> = {
    green: '#00B050',
    amber: '#FF9800',
    red: '#F44336',
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function validateDateFormat(dateStr: string, label: string): void {
    if (!/^\d{8}$/.test(dateStr)) {
        throw new Error(label + ' must be exactly 8 digits in DDMMYYYY format. Got: "' + dateStr + '"');
    }
    const day = parseInt(dateStr.slice(0, 2), 10);
    const month = parseInt(dateStr.slice(2, 4), 10);
    const year = parseInt(dateStr.slice(4, 8), 10);

    if (month < 1 || month > 12) {
        throw new Error(label + ' has invalid month ' + month + '. Expected 01-12.');
    }
    if (day < 1 || day > 31) {
        throw new Error(label + ' has invalid day ' + day + '. Expected 01-31.');
    }

    const parsed = new Date(year, month - 1, day);
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
        throw new Error(label + ' is not a valid calendar date: ' + dateStr);
    }
}

function parseDDMMYYYY(dateStr: string): string {
    const day = dateStr.slice(0, 2);
    const month = dateStr.slice(2, 4);
    const year = dateStr.slice(4, 8);
    return year + '-' + month + '-' + day;
}

function ordinalSuffix(day: number): string {
    if (day >= 11 && day <= 13) return day + 'th';
    switch (day % 10) {
        case 1: return day + 'st';
        case 2: return day + 'nd';
        case 3: return day + 'rd';
        default: return day + 'th';
    }
}

function formatDateForSubject(isoDate: string): string {
    const d = new Date(isoDate + 'T00:00:00');
    return ordinalSuffix(d.getDate()) + ' ' + MONTH_NAMES[d.getMonth()];
}

function computeNextReportDate(endDateIso: string): string {
    const end = new Date(endDateIso + 'T00:00:00');
    const endDow = end.getDay(); // 0=Sun ... 6=Sat

    // Early-week reports end Mon-Thu (1-4) -> next report on the upcoming Monday.
    // Late-week reports end Fri-Sun (5,6,0) -> next report on the upcoming Thursday.
    const targetDow = (endDow >= 1 && endDow <= 4) ? 1 : 4; // 1=Mon, 4=Thu

    const next = new Date(end);
    do {
        next.setDate(next.getDate() + 1);
    } while (next.getDay() !== targetDow);

    const fullDay = FULL_DAY_NAMES[next.getDay()];
    return fullDay + ', ' + ordinalSuffix(next.getDate()) + ' ' + MONTH_NAMES[next.getMonth()];
}

// ---------------------------------------------------------------------------
// Email HTML builder
// ---------------------------------------------------------------------------

function getHealthColor(status: string): string {
    const lower = (status || 'green').toLowerCase();
    return STATUS_COLORS[lower] || STATUS_COLORS['green'];
}

function getHealthLabel(status: string): string {
    const lower = (status || 'green').toLowerCase();
    if (lower.includes('red')) return 'Red';
    if (lower.includes('amber') || lower.includes('yellow')) return 'Amber';
    return 'Green';
}

function buildProjectEmailHtml(
    aiSummary: string,
    aiRisk: string,
    deterministicHealth: string,
    introHtml: string,
    senderName: string
): string {
    const healthLabel = getHealthLabel(deterministicHealth);
    const healthColor = getHealthColor(deterministicHealth);
    const baseStyle = 'font-family:Calibri,sans-serif;font-size:11pt;color:#212121';
    const boldBlack = 'font-family:Calibri,sans-serif;color:black';

    const summaryParas = aiSummary.split(/\n\n+/);
    const summaryDetailStyle = 'margin-left:0.5in;' + boldBlack;
    const summaryHtml = summaryParas.slice(1)
        .map(function (para) {
            return '<p style="' + summaryDetailStyle + '">' + escapeHtml(para.trim()).replace(/\n/g, '<br>') + '</p>';
        })
        .join('\n');

    const html = '<html>\n'
        + '<body style="word-wrap:break-word">\n'
        + '<div style="page:WordSection1">\n'
        + '<p style="' + baseStyle + '">Hi All,</p>\n'
        + '<p style="' + baseStyle + '">&nbsp;</p>\n'
        + introHtml
        + '<p style="' + boldBlack + '">&nbsp;</p>\n'
        + '<p style="' + boldBlack + '"><b>Project Status</b></p>\n'
        + '<ul style="margin-top:0in" type="disc">\n'
        + '<li style="color:black;background:white"><b style="' + boldBlack + '">Status:</b>&nbsp;'
        + '<u style="' + boldBlack + ';color:' + healthColor + '">' + escapeHtml(healthLabel) + '</u></li>\n'
        + '<li style="color:black;background:white"><b style="' + boldBlack + '">Summary.</b> '
        + '<span style="' + boldBlack + '">' + escapeHtml(aiSummary.split('\n\n')[0]) + '</span></li>\n'
        + '</ul>\n'
        + summaryHtml + '\n'
        + '<ul type="disc">\n'
        + '<li style="color:black;background:white"><b style="' + boldBlack + '">Risks / Observations :&nbsp;</b>'
        + '<span style="' + boldBlack + '">' + escapeHtml(aiRisk) + '</span></li>\n'
        + '</ul>\n'
        + '<p style="' + boldBlack + '">Thanks &amp; Regards,<br>' + escapeHtml(senderName) + '</p>\n'
        + '</div>\n'
        + '</body>\n'
        + '</html>';

    return html;
}

// ---------------------------------------------------------------------------
// Outlook AppleScript draft creator
// ---------------------------------------------------------------------------

function escapeAppleScript(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function createOutlookDraft(
    toRecipients: string,
    ccRecipients: string,
    subject: string,
    htmlBody: string
): void {
    const toList = toRecipients
        ? toRecipients.split(',').map(function (e) { return e.trim(); }).filter(Boolean)
        : [];
    const ccList = ccRecipients
        ? ccRecipients.split(',').map(function (e) { return e.trim(); }).filter(Boolean)
        : [];

    let toCommands = '';
    for (const addr of toList) {
        toCommands += '\n            make new to recipient at newMsg with properties {email address:{address:"' + escapeAppleScript(addr) + '"}}';
    }

    let ccCommands = '';
    for (const addr of ccList) {
        ccCommands += '\n            make new cc recipient at newMsg with properties {email address:{address:"' + escapeAppleScript(addr) + '"}}';
    }

    const script = 'tell application "Microsoft Outlook"\n'
        + '    activate\n'
        + '    set newMsg to make new outgoing message with properties {subject:"' + escapeAppleScript(subject) + '", content:"' + escapeAppleScript(htmlBody) + '"}\n'
        + toCommands + '\n'
        + ccCommands + '\n'
        + '    open newMsg\n'
        + 'end tell';

    const tmpFile = path.join('/tmp', 'outlook_draft_' + Date.now() + '.scpt');
    fs.writeFileSync(tmpFile, script);
    try {
        execSync('osascript "' + tmpFile + '"', { timeout: 30000 });
    } finally {
        try { fs.unlinkSync(tmpFile); } catch (_e) { /* ignore cleanup errors */ }
    }
}

// ---------------------------------------------------------------------------
// Project processing
// ---------------------------------------------------------------------------

async function processProject(
    project: Project,
    window: { startDate: string; endDate: string },
    reportsDir: string,
    endDateStr: string,
    label: string | null,
    toRecipients: string,
    mode: string,
    emitHtml: boolean
): Promise<'success' | 'skipped' | 'failed'> {
    console.log('\n================================');
    console.log('Processing: ' + project.code + ' - ' + project.name);

    let rollup: ProjectRangeRollup | null;
    try {
        rollup = await rollupProjectRange(project, window);
    } catch (err: any) {
        console.error('Rollup error for ' + project.code + ': ' + err.message);
        return 'failed';
    }

    if (!rollup) {
        console.log('No DSR data found for Project ' + project.code + ' in the given date range. Skipping.');
        return 'skipped';
    }

    console.log('Found ' + rollup.snapshotCount + ' snapshots for ' + project.code + ', deterministic health=' + rollup.deterministicHealth);

    let aiSummary = 'N/A';
    let aiRisk = 'N/A';
    try {
        const result = await aiService.generateRangeProjectSummary(rollup);
        aiSummary = result.summary;
        aiRisk = result.risk;
    } catch (err: any) {
        console.error('AI Generation Error for ' + project.code + ': ' + err.message);
        return 'failed';
    }

    const { temporalValidator } = require('./src/common/utils');
    const validation = temporalValidator.validateTemporalClaims(
        JSON.stringify({ summary: aiSummary, risk: aiRisk }),
        'RangeProject-' + project.code
    );
    if (!validation.isValid || validation.suspiciousClaims.length > 0) {
        console.warn('Temporal validation warnings for ' + project.code + ': ' + temporalValidator.generateValidationReport(validation));
    }

    const senderName = config.email.senderName || 'Ganeshan A';
    const senderAddress = config.email.senderAddress || '';
    const cc = config.email.defaultCc;

    const startDateHuman = formatDateForSubject(window.startDate);
    const endDateHuman = formatDateForSubject(window.endDate);

    let subject: string;
    let introHtml: string;
    const baseStyle = 'font-family:Calibri,sans-serif;font-size:11pt;color:#212121';
    if (label) {
        subject = label + '- ' + project.code + '-[' + startDateHuman + '- ' + endDateHuman + ']';
        introHtml = '<p style="' + baseStyle + '">Herewith, I am sharing the&nbsp;<b>' + escapeHtml(label.toLowerCase()) + '</b>'
            + ' for the period&nbsp;<b>' + escapeHtml(startDateHuman) + '</b>&nbsp;to&nbsp;<b>' + escapeHtml(endDateHuman) + '</b>.</p>\n';
    } else {
        const nextReportDate = computeNextReportDate(window.endDate);
        subject = 'Twice-weekly Updates- ' + project.code + '-[' + startDateHuman + '- ' + endDateHuman + ']';
        introHtml = '<p style="' + baseStyle + '">Herewith, I am sharing the&nbsp;<b>twice-weekly project report</b>. '
            + 'The next report will be shared on&nbsp;<b>' + escapeHtml(nextReportDate) + '</b>.</p>\n';
    }

    const htmlBody = buildProjectEmailHtml(aiSummary, aiRisk, rollup.deterministicHealth, introHtml, senderName);

    if (mode === 'outlook') {
        console.log('Opening Outlook draft for ' + project.code + '...');
        createOutlookDraft(toRecipients, cc, subject, htmlBody);
        console.log('Outlook draft created: ' + subject);
    } else {
        const from = senderName + ' <' + senderAddress + '>';
        const emlContent = buildEmlContent(from, toRecipients, cc, subject, htmlBody);
        const emlFileName = project.code + '_' + endDateStr + '.eml';
        const emlPath = path.join(reportsDir, emlFileName);
        fs.writeFileSync(emlPath, emlContent);
        console.log('Email draft saved: ' + emlPath);
    }

    console.log('  Subject: ' + subject);
    if (emitHtml) {
        const htmlFileName = project.code + '_' + endDateStr + '.html';
        const htmlPath = path.join(reportsDir, htmlFileName);
        fs.writeFileSync(htmlPath, htmlBody);
        console.log('  HTML backup: ' + htmlPath);
    }
    return 'success';
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function runWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let index = 0;

    async function worker(): Promise<void> {
        while (index < items.length) {
            const i = index++;
            results[i] = await fn(items[i]);
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function generateEmailDrafts(accountName: string, startDateStr: string, endDateStr: string, toRecipients: string, mode: string, emitHtml: boolean, label: string | null) {
    console.log('Starting Email Draft Generation');
    console.log('Mode: ' + mode + (mode === 'outlook' ? ' (AppleScript)' : ' (.eml files)'));
    console.log('Account: ' + accountName + ', Window: ' + startDateStr + ' to ' + endDateStr + (label ? ', Label: "' + label + '"' : ''));
    if (toRecipients) {
        console.log('To: ' + toRecipients);
    }

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
            where: { name: { [Op.iLike]: '%' + accountName + '%' } }
        });

        if (!account) {
            console.error('Account matching "' + accountName + '" not found.');
            process.exit(1);
        }

        console.log('Found Account: ' + account.name + ' (ID: ' + account.id + ')');

        const projects = await Project.findAll({
            where: {
                accountId: account.id,
                isSharedTeam: false
            }
        });

        console.log('Found ' + projects.length + ' valid projects (excluding shared teams).');

        const outputDirName = startDateStr + '_to_' + endDateStr;
        const rootDir = path.resolve(__dirname, '../');
        const reportsDir = path.join(rootDir, 'reports', 'email_drafts', outputDirName);

        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        const results = await runWithConcurrency(projects, MAX_CONCURRENCY, function (project) {
            return processProject(project, { startDate: window.startDate, endDate: window.endDate }, reportsDir, endDateStr, label, toRecipients, mode, emitHtml);
        });

        const successCount = results.filter(function (r) { return r === 'success'; }).length;
        const skippedCount = results.filter(function (r) { return r === 'skipped'; }).length;
        const failedCount = results.filter(function (r) { return r === 'failed'; }).length;

        console.log('\nResults: ' + successCount + ' success, ' + skippedCount + ' skipped, ' + failedCount + ' failed');

        if (failedCount > 0) {
            hasErrors = true;
        }

        console.log('\nAll done! Output saved to: ' + reportsDir);
        if (mode === 'eml') {
            console.log('Download the .eml files and drag them into Outlook Drafts folder to edit and send.');
        }

        // Same reasoning as generateAccountReport.ts: aiService.generateRangeProjectSummary
        // fire-and-forgets recordAiUsage, which the imminent process.exit() would otherwise cut off.
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
        default: 'CCM',
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
    .option('to', {
        type: 'string',
        default: '',
        description: 'Comma-separated TO recipients (e.g. "a@example.com,b@example.com")'
    })
    .option('mode', {
        type: 'string',
        default: 'outlook',
        choices: ['outlook', 'eml'],
        description: 'outlook = open draft in Mac Outlook (local only), eml = generate .eml files (works over SSH)'
    })
    .option('html', {
        type: 'boolean',
        default: false,
        description: 'Also write a .html backup file alongside each .eml (off by default)'
    })
    .option('label', {
        type: 'string',
        default: '',
        description: 'When set, switches the subject/intro from the default twice-weekly cadence wording ("next report on X") to this label plus an explicit date range (e.g. "Monthly Update", "Q3 2026 Delivery Summary")'
    })
    .parseSync();

generateEmailDrafts(argv.account, argv['start-date'], argv['end-date'], argv.to, argv.mode, argv.html, argv.label || null);
