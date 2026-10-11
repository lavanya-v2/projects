#!/usr/bin/env node
/**
 * No-admin setup for the Claude Usage Collector.
 *
 * None of these require administrator rights or IT involvement — they all write
 * only inside your own user folder. Node is already present (Claude Code needs it).
 *
 *   node setup.js --token <clct_...> --url <lens-url>            write config.json
 *   node setup.js --token <..> --url <..> --hook --schedule      + both auto-run triggers
 *   node setup.js --schedule [--at 13:05,18:05]                  daily OS job, weekdays only
 *   node setup.js --unschedule | --uninstall-hook                undo either one
 *   node setup.js --reset                                        clean slate (config + both triggers)
 *
 * Two INDEPENDENT triggers, deliberately. Belt and braces:
 *
 *   1. --schedule  registers a real OS job (launchd on macOS, Task Scheduler on
 *      Windows) that runs Mon-Fri whether or not you touched Claude Code. This is
 *      what guarantees a member appears in Lens every working day.
 *   2. --hook      adds a Claude Code SessionEnd hook, so a session you just
 *      finished shows up without waiting for the next scheduled fire.
 *
 * They cannot suppress each other: --throttle is the only thing in collector.js
 * that reads or writes .last-run, and the scheduled run deliberately passes none.
 *
 * Neither needs administrator rights. Both write only inside your own user folder.
 * Where corporate policy blocks the OS scheduler outright, --schedule falls back
 * (Task Scheduler -> Startup folder -> hook only) and tells you which tier is live
 * rather than claiming success it did not achieve.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const COLLECTOR = path.join(HERE, 'collector.js');
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_CMD = `node "${COLLECTOR}" --throttle 12`;
// SessionStart fires at the START of a session (or resume/clear/compact/fork) rather
// than at the end — an earlier, more frequent trigger point than SessionEnd, useful
// on machines where the OS-level --schedule tier is blocked (e.g. Task Scheduler
// locked down by Group Policy). Gated by its own interval, read from config.json's
// sessionStartIntervalSeconds (default 1 day) — see collector.js's --session-start
// handling. No admin needed; same settings.json mechanism as SessionEnd.
const SESSION_START_HOOK_CMD = `node "${COLLECTOR}" --session-start`;

const LABEL = 'com.lens.claude-usage-collector';
const TASK_NAME = 'LensClaudeUsageCollector';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const SCHED_LOG = path.join(HERE, 'schedule.log');

// Two fire times so a shut lid at one still leaves a chance at the other, and :05
// rather than :00 to stay off the crowded top of the hour.
const DEFAULT_TIMES = [[13, 5], [18, 5]];

// The scheduled run carries NO --throttle (see header) and --days 4 rather than the
// default 2: collector.js selects the last N *active* days, not calendar days, so a
// machine that was off for a stretch would otherwise skip the days before it. Ingest
// is idempotent, so re-sending costs nothing.
const SCHED_ARGS = ['--days', '4', '--skip-weekends'];

// Tier names reported back to the user and to Lens, best first.
const TIER = { SCHEDULER: 'scheduler', STARTUP: 'startup', HOOK: 'hook', NONE: 'none' };

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

function readJson(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}
function isOurHookGroup(g) {
    // Match on the install directory name, not just "collector.js" — an interim
    // build once pointed SessionStart at a differently-named wrapper script in the
    // same folder, and a narrower check left that stale entry behind on upgrade
    // instead of de-duping it. Matching the folder name catches any command that
    // lives inside our install dir, current or past.
    return g && Array.isArray(g.hooks) &&
        g.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes('claude-usage-collector'));
}

// --- small shared helpers ---

// Run a command, swallowing failure. Used where "not installed" is a normal,
// expected non-zero exit (launchctl bootout on a job that was never loaded).
function quiet(cmd, args) {
    try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; }
}
function capture(cmd, args) {
    try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
}
const xmlEsc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const pad2 = (n) => String(n).padStart(2, '0');

function parseTimes(spec) {
    if (!spec) return DEFAULT_TIMES;
    const out = [];
    for (const part of String(spec).split(',')) {
        const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(part);
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
            console.error(`Bad --at value "${part.trim()}" — expected HH:MM[,HH:MM]`);
            process.exit(1);
        }
        out.push([Number(m[1]), Number(m[2])]);
    }
    return out;
}
const fmtTimes = (times) => times.map(([h, m]) => `${pad2(h)}:${pad2(m)}`).join(' and ');

function writeConfig(token, url) {
    const cfg = { lensBaseUrl: url, ingestToken: token, enabled: true };
    fs.writeFileSync(path.join(HERE, 'config.json'), JSON.stringify(cfg, null, 2));
    try { fs.chmodSync(path.join(HERE, 'config.json'), 0o600); } catch { /* windows */ }
    console.log('✓ Wrote config.json');
}

function installHook() {
    const s = readJson(CLAUDE_SETTINGS);
    s.hooks = s.hooks || {};
    s.hooks.SessionEnd = Array.isArray(s.hooks.SessionEnd) ? s.hooks.SessionEnd : [];
    s.hooks.SessionEnd = s.hooks.SessionEnd.filter((g) => !isOurHookGroup(g)); // de-dupe
    s.hooks.SessionEnd.push({ hooks: [{ type: 'command', command: HOOK_CMD }] });

    s.hooks.SessionStart = Array.isArray(s.hooks.SessionStart) ? s.hooks.SessionStart : [];
    s.hooks.SessionStart = s.hooks.SessionStart.filter((g) => !isOurHookGroup(g)); // de-dupe
    s.hooks.SessionStart.push({ hooks: [{ type: 'command', command: SESSION_START_HOOK_CMD }] });

    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(s, null, 2));
    console.log('✓ Installed Claude Code hooks — SessionEnd (after each session, throttled ~12h) and');
    console.log('  SessionStart (at the start of each session, gated to once per day by default). No admin needed.');
}

function uninstallHook() {
    const s = readJson(CLAUDE_SETTINGS);
    if (s.hooks && Array.isArray(s.hooks.SessionEnd)) {
        s.hooks.SessionEnd = s.hooks.SessionEnd.filter((g) => !isOurHookGroup(g));
    }
    if (s.hooks && Array.isArray(s.hooks.SessionStart)) {
        s.hooks.SessionStart = s.hooks.SessionStart.filter((g) => !isOurHookGroup(g));
    }
    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(s, null, 2));
    console.log('✓ Removed the Claude Code hooks (SessionEnd + SessionStart).');
}

function reset() {
    // Uninstall BOTH triggers, then wipe local state — one command for a clean slate.
    try { uninstallHook(); } catch { /* ignore */ }
    try { schedule(false); } catch { /* ignore */ }
    for (const f of ['config.json', 'outbox.json', '.last-run', 'dashboard.html', 'schedule.log']) {
        try { fs.unlinkSync(path.join(HERE, f)); } catch { /* not present */ }
    }
    console.log('✓ Reset: removed config, outbox, throttle, dashboard, the daily job and the hook.');
}

// --- macOS: per-user LaunchAgent (never needs admin) ---

function macPlist(times) {
    // launchd hands jobs a minimal PATH, and an nvm-managed node lives outside it,
    // so pin the interpreter we are running under. Fall back to a LOGIN shell lookup
    // if that path ever vanishes (node upgrade, nvm version switch).
    const cmd = `NODE=${shq(process.execPath)}; [ -x "$NODE" ] || NODE="$(command -v node)"; `
        + `exec "$NODE" ${shq(COLLECTOR)} ${SCHED_ARGS.map(shq).join(' ')}`;
    // Weekday 1-5 = Mon-Fri (0 and 7 are Sunday, 6 is Saturday). One dict per
    // time per weekday, so weekends never fire at all.
    const cal = [];
    for (const [h, m] of times) {
        for (let wd = 1; wd <= 5; wd++) {
            cal.push(`    <dict><key>Weekday</key><integer>${wd}</integer>`
                + `<key>Hour</key><integer>${h}</integer>`
                + `<key>Minute</key><integer>${m}</integer></dict>`);
        }
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>${xmlEsc(cmd)}</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
${cal.join('\n')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xmlEsc(SCHED_LOG)}</string>
  <key>StandardErrorPath</key><string>${xmlEsc(SCHED_LOG)}</string>
</dict></plist>
`;
}

function macSchedule(times) {
    fs.mkdirSync(path.dirname(PLIST), { recursive: true });
    fs.writeFileSync(PLIST, macPlist(times));
    const target = `gui/${process.getuid()}`;
    quiet('launchctl', ['bootout', `${target}/${LABEL}`]);   // no-op if never loaded
    if (!quiet('launchctl', ['bootstrap', target, PLIST])) { // older macOS
        quiet('launchctl', ['unload', PLIST]);
        quiet('launchctl', ['load', PLIST]);
    }
}

/**
 * Prove the job is really registered AND really points at this collector.
 *
 * All three checks earn their place. A plist on disk is not a schedule (launchd
 * must know about it), and a loaded label is not a working schedule either: an
 * earlier install from a different directory leaves a job with the same label
 * pointing at a path that no longer has a config.json, which then fires and dies
 * every day into a log nobody reads. Checking the label alone would report that
 * corpse as healthy — which is the exact failure this whole change exists to end.
 */
function macVerify() {
    if (!fs.existsSync(PLIST)) return false;
    if (!quiet('plutil', ['-lint', PLIST])) return false;
    let onDisk = '';
    try { onDisk = fs.readFileSync(PLIST, 'utf8'); } catch { return false; }
    if (!onDisk.includes(COLLECTOR)) return false;   // stale job from another install dir
    return capture('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`]).includes(LABEL)
        || capture('launchctl', ['list']).includes(LABEL);
}

function macUnschedule() {
    quiet('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`]);
    quiet('launchctl', ['unload', PLIST]);
    try { fs.unlinkSync(PLIST); } catch { /* not present */ }
}

// --- Windows: per-user scheduled task (no admin: InteractiveToken/LeastPrivilege) ---

function winTaskXml(times) {
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const triggers = times.map(([h, m]) =>
        `    <CalendarTrigger>
      <StartBoundary>2024-01-01T${pad2(h)}:${pad2(m)}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByWeek>
        <WeeksInterval>1</WeeksInterval>
        <DaysOfWeek>${DAYS.map((d) => `<${d} />`).join('')}</DaysOfWeek>
      </ScheduleByWeek>
    </CalendarTrigger>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Sends content-free Claude usage numbers to Lens (weekdays).</Description>
  </RegistrationInfo>
  <Triggers>
${triggers}
    <LogonTrigger><Enabled>true</Enabled><Delay>PT5M</Delay></LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <!-- Task Scheduler defaults refuse to start on battery and kill a running task
         when the laptop unplugs. On a laptop that silently defeats the schedule --
         and schtasks has no command-line flag to override them, which is exactly
         why this task is registered from XML rather than /SC WEEKLY. -->
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <!-- Without this a trigger missed while asleep/off is skipped forever. -->
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEsc(process.execPath)}</Command>
      <Arguments>${xmlEsc(`"${COLLECTOR}" ${SCHED_ARGS.join(' ')}`)}</Arguments>
      <WorkingDirectory>${xmlEsc(HERE)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

function winSchedule(times) {
    const tmp = path.join(os.tmpdir(), `lens-collector-task-${process.pid}.xml`);
    // schtasks /XML accepts UTF-16 only; a UTF-8 file fails with the unhelpful
    // "The task XML is malformed". The BOM matters as much as the encoding.
    fs.writeFileSync(tmp, '﻿' + winTaskXml(times), 'utf16le');
    try {
        execFileSync('schtasks', ['/Create', '/TN', TASK_NAME, '/XML', tmp, '/F'], { stdio: 'ignore' });
    } finally {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
}

// Query the task back and confirm the settings actually stuck. Task Scheduler will
// happily accept a task and then apply its own defaults, so registering is not proof.
function winVerify() {
    const xml = capture('schtasks', ['/Query', '/TN', TASK_NAME, '/XML']).replace(/\0/g, '');
    if (!xml.includes('<Task')) return false;
    return /<DisallowStartIfOnBatteries>\s*false/i.test(xml)
        && /<StartWhenAvailable>\s*true/i.test(xml);
}

function winUnschedule() {
    quiet('schtasks', ['/Delete', '/TN', TASK_NAME, '/F']);
}

// --- tier dispatcher ---

/**
 * Install (or remove) the recurring trigger, best tier first, and REPORT WHAT
 * ACTUALLY HAPPENED. Never throws and never exits non-zero: a locked-down machine
 * that cannot schedule must still finish the install with the hook in place.
 * Returns the tier that is live, so the installer can print a verified claim
 * instead of an assumption.
 */
function schedule(install, atSpec) {
    const plat = os.platform();
    const times = parseTimes(atSpec);

    if (!install) {
        try {
            if (plat === 'darwin') macUnschedule();
            else if (plat === 'win32') { winUnschedule(); startup(false, true); }
        } catch { /* best effort */ }
        console.log('✓ Daily job removed.');
        return TIER.NONE;
    }

    try {
        if (plat === 'darwin') {
            macSchedule(times);
            if (macVerify()) {
                console.log(`✓ Daily job registered and verified with launchd — ${fmtTimes(times)}, Mon-Fri, plus once at login. No admin needed.`);
                return TIER.SCHEDULER;
            }
            console.error('! launchd accepted no job — falling back to the Claude session hook only.');
            return TIER.HOOK;
        }
        if (plat === 'win32') {
            try {
                winSchedule(times);
                if (winVerify()) {
                    console.log(`✓ Daily task registered and verified with Task Scheduler — ${fmtTimes(times)}, Mon-Fri, plus once at login. No admin needed.`);
                    return TIER.SCHEDULER;
                }
                console.error('! Task Scheduler did not keep the task settings — trying the Startup folder instead.');
            } catch (e) {
                console.error(`! Task Scheduler unavailable (${e.message.split('\n')[0]}) — trying the Startup folder instead.`);
            }
            // Tier 2: Startup folder. Also no admin, fires at every login.
            try {
                startup(true, true);
                console.log('✓ Fallback: runs at login via the Startup folder (no admin). Not a true daily schedule.');
                return TIER.STARTUP;
            } catch (e) {
                console.error(`! Startup folder unavailable (${e.message.split('\n')[0]}).`);
            }
            console.error('! No OS trigger could be installed — the Claude session hook is your only trigger.');
            return TIER.HOOK;
        }
        console.log('Note: --schedule automates macOS and Windows. On Linux, add this to "crontab -e":');
        for (const [h, m] of times) {
            console.log(`  ${m} ${h} * * 1-5 ${process.execPath} ${COLLECTOR} ${SCHED_ARGS.join(' ')}`);
        }
        return TIER.HOOK;
    } catch (e) {
        // Scheduling problems must never fail the install.
        console.error(`! Could not install the daily job: ${e.message.split('\n')[0]}`);
        console.error('  The Claude session hook still covers you. Re-run with --schedule later.');
        return TIER.HOOK;
    }
}

/** Read the live tier without changing anything (used by --status and by ingest). */
function currentTier() {
    if (os.platform() === 'darwin' && macVerify()) return TIER.SCHEDULER;
    if (os.platform() === 'win32') {
        if (winVerify()) return TIER.SCHEDULER;
        if (fs.existsSync(startupBatPath())) return TIER.STARTUP;
    }
    const s = readJson(CLAUDE_SETTINGS);
    const hasSessionEnd = s.hooks && Array.isArray(s.hooks.SessionEnd) && s.hooks.SessionEnd.some(isOurHookGroup);
    const hasSessionStart = s.hooks && Array.isArray(s.hooks.SessionStart) && s.hooks.SessionStart.some(isOurHookGroup);
    if (hasSessionEnd || hasSessionStart) return TIER.HOOK;
    return TIER.NONE;
}

function startupBatPath() {
    return path.join(process.env.APPDATA || '', 'Microsoft', 'Windows',
        'Start Menu', 'Programs', 'Startup', 'claude-usage-collector.bat');
}

/**
 * Windows Startup-folder entry — the tier-2 fallback when Task Scheduler is blocked.
 * `quietly` is set when called from schedule(), which owns the messaging and must
 * never exit the process on failure.
 */
function startup(install, quietly) {
    if (os.platform() !== 'win32') {
        if (quietly) throw new Error('Startup folder is Windows-only');
        console.error('--startup is Windows-only. On macOS use --schedule (launchd, also no admin).');
        process.exit(1);
    }
    const bat = startupBatPath();
    if (install) {
        fs.mkdirSync(path.dirname(bat), { recursive: true });
        fs.writeFileSync(bat, `@echo off\r\nnode "${COLLECTOR}" ${SCHED_ARGS.join(' ')}\r\n`);
        if (!quietly) console.log('✓ Added to Startup (runs at login, no admin):', bat);
    } else {
        try { fs.unlinkSync(bat); } catch { /* not present */ }
        if (!quietly) console.log('✓ Removed from Startup.');
    }
}

// Exported for tests, so the Windows task XML can be asserted from any platform
// (see win-xml-check). Importing must stay side-effect free.
module.exports = { winTaskXml, macPlist, parseTimes, currentTier, TIER };
if (require.main !== module) return;

// --- run ---
const token = val('--token');
const url = val('--url');

if (token && url) writeConfig(token, url);
else if (token || url) { console.error('Provide BOTH --token and --url.'); process.exit(1); }

if (has('--reset')) reset();
if (has('--hook')) installHook();
if (has('--uninstall-hook')) uninstallHook();
if (has('--schedule')) schedule(true, val('--at'));
if (has('--unschedule')) schedule(false);
if (has('--startup')) startup(true);
if (has('--uninstall-startup')) startup(false);

// --status prints the live trigger tier, machine-readable on the last line. This is
// what the installer echoes back so its closing claim is verified, not assumed.
if (has('--status')) {
    const tier = currentTier();
    const say = {
        [TIER.SCHEDULER]: 'a daily OS job (weekdays) plus the Claude session hook',
        [TIER.STARTUP]: 'a run-at-login entry plus the Claude session hook (no true daily job)',
        [TIER.HOOK]: 'the Claude session hook only — no daily job, so a day with no Claude session sends nothing',
        [TIER.NONE]: 'NOTHING — no trigger installed',
    }[tier];
    console.log(`Reporting is driven by: ${say}`);
    // The VPN gate is the other reason reports can stop, and unlike the trigger it
    // changes minute to minute — so the two are reported together. Without this,
    // "installed correctly but sending nothing" has no visible explanation.
    try {
        const { detectVpn } = require('./vpn');
        const v = detectVpn(readJson(path.join(__dirname, 'config.json')));
        console.log(v.onVpn
            ? `VPN: detected (${v.reason}) — reports are being queued, not sent`
            : 'VPN: none detected — reports can be sent');
    } catch {
        console.log('VPN: cannot tell (vpn.js missing) — the collector will queue, not send');
    }
    console.log(`tier=${tier}`);
}

if (!argv.length) {
    console.log([
        'No-admin setup — nothing here needs administrator rights.',
        '',
        '  node setup.js --token <clct_...> --url <lens-url>         write config.json',
        '  node setup.js --token <..> --url <..> --hook --schedule   + both auto-run triggers',
        '  node setup.js --schedule [--at 13:05,18:05]               daily OS job, Mon-Fri',
        '  node setup.js --status                                    what is actually driving reports',
        '  node setup.js --unschedule | --uninstall-hook             undo either trigger',
        '  node setup.js --reset                                     clean slate (config + both triggers)',
        '',
        'The daily job is what guarantees you appear in Lens every working day; the',
        'hook only fires when you finish a Claude session. Install both.',
    ].join('\n'));
}
