'use strict';
/**
 * VPN detection — the network-silence gate for the collector.
 * ==========================================================
 *
 * WHY THIS EXISTS: engineers work inside customer VPNs. Any request we make while
 * a tunnel is up — including the DNS lookup that precedes it — is visible to the
 * customer's network monitoring. The data is only counts, but an agent seen
 * reaching out from inside their perimeter is an impression we cannot afford. So
 * the collector sends NOTHING while a tunnel is detected; the day's numbers are
 * computed locally and parked in the outbox until a trigger fires off VPN.
 *
 * STAGE 2 — DELIBERATELY SIMPLE, DELIBERATELY CUSTOMER-SPECIFIC. Earlier versions
 * of this file (still in git history, nothing lost) tried to detect ANY VPN, on
 * ANY network, generically — interface shape, Hyper-V exclusions, keyword lists
 * across processes and adapter names. That machinery kept finding new edge cases
 * on real machines (Hyper-V/WSL false positives, then a keyword list that matched
 * ordinary software) faster than it could be trusted. This version replaces all
 * of it with one fact, verified against six real machines with zero exceptions:
 * on Windows, a machine connected to CCM's VPN shows
 *
 *     Connection-specific DNS Suffix  . : crosscountrymtg.local
 *
 * on its active network adapter, in the plain output of `ipconfig` — and does not
 * show it, on any adapter, when not connected. No PowerShell, no process list, no
 * interface-shape reasoning, no product names to enumerate. Enrollment is handled
 * on the human side (only CCM team members are given this build), so the tool
 * itself does not need to be multi-customer-aware yet — see the plan file for the
 * later, parked step (Stage 3) that would make the expected domain configurable
 * rather than hardcoded.
 *
 * macOS is unaffected by any of this — its tunnel check (a real network card has
 * a hardware address, a tunnel does not) has never produced a false positive and
 * is left exactly as it was.
 *
 * FAIL-CLOSED, WITH ONE DELIBERATE CHANGE. A check that cannot run still tells us
 * nothing about whether a VPN is up — but earlier versions of this file treated
 * "cannot tell" identically to "on VPN", which meant a machine whose check broke
 * would go silent forever with no way for anyone to notice why. This version
 * still refuses to send while it can positively confirm a VPN, but "the check
 * itself did not run" now sends anyway, marked as unverified rather than staying
 * silent — visible to a human on the admin side (see collector.js's `vpnGate`
 * and the server-side audit log), rather than invisible.
 *
 * PRIVACY: this module returns a verdict and one word of reason. Adapter names,
 * addresses, and DNS suffixes are used to decide and then discarded — none are
 * returned, so none can reach a payload or a log.
 *
 * Node standard library only (os, child_process) — the collector has no npm
 * dependencies and must keep it that way.
 */

const os = require('os');
const cp = require('child_process');

// A check must never hang a SessionEnd hook. `ipconfig`/`ifconfig` are fast,
// native tools — no PowerShell startup cost to budget for here.
const PROBE_TIMEOUT_MS = 2500;

/**
 * The one fact this file checks for on Windows. Verified against six real CCM
 * team members' machines (five genuine same-machine on/off comparisons among
 * them) — present on the active adapter while connected, absent everywhere when
 * not, including on machines with an unrelated Hyper-V virtual adapter that
 * would have false-positived under the old interface-shape approach.
 */
const CCM_VPN_DNS_SUFFIX = 'crosscountrymtg.local';

const TUNNEL_DEVICE_CLASS = /^(utun|tun|tap|ppp|ipsec|wg|gpd)\d*$/i;

// ---------------------------------------------------------------------------
// Address classification (macOS/Linux tunnel check only)
// ---------------------------------------------------------------------------

function classifyAddress(addr) {
    if (!addr || !addr.address) return 'unknown';
    const a = String(addr.address);
    if (addr.internal) return 'loopback';
    if (addr.family === 'IPv4' || addr.family === 4) {
        if (a.startsWith('127.')) return 'loopback';
        if (a.startsWith('169.254.')) return 'link-local';
        if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)) return 'routable-shared';
        if (/^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a)) return 'routable-private';
        return 'routable-public';
    }
    if (/^fe80/i.test(a)) return 'link-local';
    if (a === '::1') return 'loopback';
    if (/^f[cd]/i.test(a)) return 'routable-private';
    return 'routable-public';
}

/**
 * An address that could actually carry traffic. Every Mac permanently carries
 * several utun interfaces for AirDrop, Handoff and iCloud Private Relay, holding
 * link-local addresses only — counting those would silence every Mac forever.
 */
function isRoutable(addr) {
    const c = classifyAddress(addr);
    return c === 'routable-private' || c === 'routable-public' || c === 'routable-shared';
}

const isZeroMac = (mac) => !mac || /^(00:){5}00$/i.test(String(mac));

// ---------------------------------------------------------------------------
// Probes (injectable, so tests need no real VPN)
// ---------------------------------------------------------------------------

function defaultExec(cmd, args, timeout) {
    return cp.execFileSync(cmd, args, {
        encoding: 'utf8',
        timeout: timeout || PROBE_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
    });
}

const DEFAULT_DEPS = {
    platform: () => process.platform,
    ifaces: () => os.networkInterfaces(),
    exec: defaultExec,
    env: () => process.env,
};

// ---------------------------------------------------------------------------
// Per-platform snapshot
//
// { tunnelNames: string[], proxy: boolean, osVpn: boolean, failed: string[] }
//
// `failed` names the checks that could not be run. It never carries a message,
// path or hostname — only the check's own name.
// ---------------------------------------------------------------------------

/**
 * macOS. Unchanged from earlier rounds — this check has never produced a false
 * positive on a real machine. A real network card has a hardware address and a
 * tunnel does not, so this needs no child process at all for its primary signal.
 */
function gatherDarwin(deps) {
    const failed = [];
    const tunnelNames = [];
    for (const [name, addrs] of Object.entries(deps.ifaces() || {})) {
        const list = addrs || [];
        if (!list.length || list.every((a) => a.internal)) continue;
        const looksLikeTunnel = list.every((a) => isZeroMac(a.mac)) || TUNNEL_DEVICE_CLASS.test(name);
        if (looksLikeTunnel) tunnelNames.push(name);
    }

    let proxy = false;
    try {
        const out = deps.exec('scutil', ['--proxy']) || '';
        proxy = /\b(HTTPEnable|HTTPSEnable|SOCKSEnable|ProxyAutoConfigEnable)\s*:\s*1\b/.test(out);
    } catch { failed.push('proxy'); }

    let osVpn = false;
    try {
        osVpn = /\(Connected\)/i.test(deps.exec('scutil', ['--nc', 'list']) || '');
    } catch { failed.push('os-vpn'); }

    return { tunnelNames, proxy, osVpn, failed };
}

/**
 * Extract the DNS suffix of every adapter block in `ipconfig`'s plain text
 * output that is actually active (carries an IPv4 address) — a disconnected
 * adapter's suffix line is always blank in every real capture collected, but
 * requiring an address too makes that assumption unnecessary to rely on.
 *
 * Adapter blocks start at an unindented line ending in a colon (e.g.
 * "Ethernet adapter Ethernet 2:"); every property below it is indented, which
 * is what lets this tell one adapter's properties from the next without
 * needing to parse the adapter name itself.
 */
function activeDnsSuffixes(ipconfigOutput) {
    const lines = String(ipconfigOutput || '').split(/\r?\n/);
    const suffixes = [];
    let suffix = null;
    let hasIPv4 = false;
    const flush = () => {
        if (suffix && hasIPv4) suffixes.push(suffix);
        suffix = null;
        hasIPv4 = false;
    };
    for (const line of lines) {
        if (/^\S.*:\s*$/.test(line)) { flush(); continue; } // new adapter block
        const m = line.match(/Connection-specific DNS Suffix\s*[.\s]*:\s*(.+)/i);
        if (m) { suffix = m[1].trim().toLowerCase(); continue; }
        if (/\bIPv4 Address/i.test(line)) hasIPv4 = true;
    }
    flush();
    return suffixes;
}

/**
 * Windows. One check: is any active adapter's DNS suffix CCM's VPN domain. See
 * the module header for why — verified against six real machines, no PowerShell
 * needed. The proxy check (registry, not PowerShell) is unrelated and unchanged
 * from earlier rounds; it has never been the source of a false positive.
 */
function gatherWin32(deps) {
    const failed = [];
    let ccmVpn = false;
    try {
        const out = deps.exec('ipconfig', []) || '';
        ccmVpn = activeDnsSuffixes(out).includes(CCM_VPN_DNS_SUFFIX);
    } catch {
        failed.push('tunnel');
    }

    let proxy = false;
    try {
        const out = deps.exec('reg',
            ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings']) || '';
        proxy = /\bProxyEnable\s+REG_DWORD\s+0x1\b/i.test(out)
            || /\bAutoConfigURL\s+REG_SZ\s+\S/i.test(out);
    } catch {
        failed.push('proxy');
    }

    return { ccmVpn, proxy, osVpn: false, failed };
}

/** Linux. A virtual interface has no backing device under /sys/class/net. */
function gatherLinux(deps) {
    const failed = [];
    const tunnelNames = [];
    const fs = require('fs');
    for (const [name, addrs] of Object.entries(deps.ifaces() || {})) {
        const list = addrs || [];
        if (!list.length || list.every((a) => a.internal)) continue;
        const noDevice = !fs.existsSync(`/sys/class/net/${name}/device`);
        if ((noDevice && list.every((a) => isZeroMac(a.mac))) || TUNNEL_DEVICE_CLASS.test(name)) {
            tunnelNames.push(name);
        }
    }
    const env = deps.env() || {};
    const proxy = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']
        .some((k) => env[k] && String(env[k]).trim());
    return { tunnelNames, proxy, osVpn: false, failed };
}

function gather(deps, platform) {
    if (platform === 'darwin') return gatherDarwin(deps);
    if (platform === 'win32') return gatherWin32(deps);
    return gatherLinux(deps);
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/**
 * Decide whether this machine is on a VPN.
 *
 * @param   {object} cfg   parsed config.json (or null)
 * @param   {object} deps  optional probe overrides, for tests
 * @returns {{onVpn: boolean, reason: string}}
 *
 * `reason` is one of: tunnel | proxy | os-vpn | unverified | clear | disabled.
 * It is an enum precisely so a caller cannot leak machine detail by logging it.
 */
function decideFromSnapshot(cfg, snap, ifaces) {
    const allow = new Set(
        (Array.isArray(cfg.vpnAllowInterfaces) ? cfg.vpnAllowInterfaces : [])
            .filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean),
    );

    // Windows: the one signal this version relies on.
    if (snap.ccmVpn) return { onVpn: true, reason: 'tunnel' };

    // macOS/Linux: unchanged interface-shape check.
    for (const name of snap.tunnelNames || []) {
        if (allow.has(name)) continue;
        if ((ifaces[name] || []).some(isRoutable)) return { onVpn: true, reason: 'tunnel' };
    }

    if (snap.proxy && cfg.treatProxyAsVpn !== false) return { onVpn: true, reason: 'proxy' };
    if (snap.osVpn) return { onVpn: true, reason: 'os-vpn' };

    // A check that could not run means we genuinely do not know — but staying
    // silent forever with no way for anyone to notice is worse than sending,
    // clearly marked as unverified. See the module header and collector.js's
    // gateState/vpnGate for how this is surfaced to a human.
    if ((snap.failed || []).length) return { onVpn: false, reason: 'unverified' };

    return { onVpn: false, reason: 'clear' };
}

function detectVpn(cfg, deps) {
    cfg = cfg || {};
    deps = { ...DEFAULT_DEPS, ...(deps || {}) };

    if (cfg.skipOnVpn === false) return { onVpn: false, reason: 'disabled' };

    const platform = deps.platform();
    let snap;
    try {
        snap = gather(deps, platform);
    } catch {
        return { onVpn: false, reason: 'unverified' };
    }
    let ifaces = {};
    try {
        ifaces = deps.ifaces() || {};
    } catch {
        return { onVpn: false, reason: 'unverified' };
    }
    return decideFromSnapshot(cfg, snap, ifaces);
}

/**
 * Name the adapter(s)/signal behind a verdict — LOCAL-DISPLAY ONLY, never wired
 * into detectVpn's return value or any payload.
 */
function explainFromSnapshot(snap, ifaces) {
    if (!snap) return { tunnelAdapters: [], ccmVpn: false, proxy: false, osVpn: false, failedChecks: [] };
    const routable = (names) => (names || []).filter((name) => (ifaces[name] || []).some(isRoutable));
    return {
        tunnelAdapters: routable(snap.tunnelNames),
        ccmVpn: !!snap.ccmVpn,
        proxy: !!snap.proxy,
        osVpn: !!snap.osVpn,
        failedChecks: snap.failed || [],
    };
}

function explainVpn(cfg, deps) {
    cfg = cfg || {};
    deps = { ...DEFAULT_DEPS, ...(deps || {}) };
    const platform = deps.platform();
    let snap;
    try {
        snap = gather(deps, platform);
    } catch {
        return { tunnelAdapters: [], ccmVpn: false, proxy: false, osVpn: false, failedChecks: ['gather'] };
    }
    let ifaces = {};
    try { ifaces = deps.ifaces() || {}; } catch { /* leave empty */ }
    return explainFromSnapshot(snap, ifaces);
}

/**
 * Probe the machine EXACTLY ONCE and return both the verdict and the data an
 * explanation needs, derived from the same snapshot — so the verdict and its
 * explanation can never contradict each other.
 */
function probeOnce(cfg, deps) {
    cfg = cfg || {};
    deps = { ...DEFAULT_DEPS, ...(deps || {}) };
    if (cfg.skipOnVpn === false) {
        return { verdict: { onVpn: false, reason: 'disabled' }, snap: null, ifaces: {} };
    }
    let snap = { tunnelNames: [], proxy: false, osVpn: false, failed: [] };
    let ifaces = {};
    let verdict;
    try {
        snap = gather(deps, deps.platform());
        ifaces = deps.ifaces() || {};
        verdict = decideFromSnapshot(cfg, snap, ifaces);
    } catch {
        verdict = { onVpn: false, reason: 'unverified' };
    }
    return { verdict, snap, ifaces };
}

module.exports = {
    detectVpn,
    explainVpn,
    probeOnce,
    decideFromSnapshot,
    explainFromSnapshot,
    gather,
    activeDnsSuffixes,
    classifyAddress,
    isRoutable,
    TUNNEL_DEVICE_CLASS,
    CCM_VPN_DNS_SUFFIX,
    PROBE_TIMEOUT_MS,
};

// ---------------------------------------------------------------------------
// Standalone
//
// `node vpn.js` prints the verdict and exits. It reads no config, needs no
// install and makes no network call. `node vpn.js --explain` additionally
// names the signal responsible, ON THIS SCREEN ONLY — never part of a payload.
// ---------------------------------------------------------------------------
if (require.main === module) {
    const { verdict: v, snap, ifaces } = probeOnce({}, DEFAULT_DEPS);

    console.log(`VPN: ${v.onVpn ? 'yes' : 'no'} (${v.reason})`);
    console.log(`platform: ${process.platform}`);
    if (v.reason === 'unverified') {
        console.log('');
        console.log('A check could not be run on this machine, so the collector could not');
        console.log('confirm whether a VPN is up. It will still send, marked as unverified,');
        console.log('so this is visible on the admin side rather than just going quiet.');
    }
    if (process.argv.includes('--explain')) {
        const e = explainFromSnapshot(snap, ifaces);
        console.log('');
        console.log('-- explain (local only, never sent anywhere) --');
        console.log('CCM VPN DNS suffix present:', e.ccmVpn);
        console.log('tunnel-looking adapters:', e.tunnelAdapters.length ? e.tunnelAdapters.join(', ') : '(none)');
        console.log('system proxy configured:', e.proxy);
        console.log('OS VPN reports connected:', e.osVpn);
        console.log('checks that could not run:', e.failedChecks.length ? e.failedChecks.join(', ') : '(none)');
    }
}
