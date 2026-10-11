#!/usr/bin/env node
'use strict';
/**
 * VPN gate — decision tests.
 *
 * Stage 2 (see the plan): this file was rewritten alongside vpn.js's simplification
 * from generic, multi-signal Windows detection down to one fact — CCM's VPN DNS
 * suffix, read from plain `ipconfig` output. The earlier, more elaborate test suite
 * (interface-shape fixtures, Hyper-V exclusion, keyword-matching, PowerShell timing)
 * is preserved in git history, not here — it tested machinery that no longer exists.
 *
 * The Windows fixtures below are real `ipconfig` captures, verbatim, from six real
 * CCM team members (five of them genuine same-machine on/off pairs), gathered before
 * any of this was built. What's being pinned down:
 *
 *   - the DNS suffix is caught when present on an active adapter, on every real
 *     capture that had it
 *   - it is NOT caught when absent, on every real capture that didn't — including
 *     machines with an unrelated Hyper-V virtual adapter, which is exactly the false
 *     positive that broke the earlier interface-shape approach
 *   - a check that cannot run now SENDS, marked unverified, instead of staying
 *     silent forever with no way for anyone to notice
 *
 * Run: node test/vpn.test.js
 */

const assert = require('assert');
const { detectVpn, probeOnce, explainFromSnapshot, activeDnsSuffixes } = require('../vpn');

let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

// --- macOS fixtures, shaped exactly as os.networkInterfaces() returns them ---
const EN0 = [
    { family: 'IPv6', address: 'fe80::64:224b', mac: '72:65:f7:d7:31:7f', internal: false },
    { family: 'IPv4', address: '192.168.1.72', mac: '72:65:f7:d7:31:7f', internal: false },
];
const LO0 = [{ family: 'IPv4', address: '127.0.0.1', mac: '00:00:00:00:00:00', internal: true }];
// What every Mac carries all the time for AirDrop / Handoff / Private Relay:
// tunnel-shaped, but link-local only, therefore carrying nothing.
const IDLE_UTUN = [{ family: 'IPv6', address: 'fe80::df63:830', mac: '00:00:00:00:00:00', internal: false }];
// A real client VPN: same shape, but with an address that can carry traffic.
const LIVE_UTUN = [{ family: 'IPv4', address: '10.55.3.9', mac: '00:00:00:00:00:00', internal: false }];
// Docker/VM bridges are virtual but not tunnels — they have a real hardware address.
const DOCKER = [{ family: 'IPv4', address: '172.17.0.1', mac: '02:42:9a:1b:2c:3d', internal: false }];

const mac = (ifaces, exec) => ({
    platform: () => 'darwin',
    ifaces: () => ifaces,
    exec: exec || (() => ''),
    env: () => ({}),
});

const NORMAL_MAC = { lo0: LO0, en0: EN0, utun0: IDLE_UTUN, utun1: IDLE_UTUN, utun2: IDLE_UTUN, utun3: IDLE_UTUN };

const silent = (r, reason, msg) => {
    assert.strictEqual(r.onVpn, true, `${msg}: expected to stay silent, got send (${r.reason})`);
    if (reason) assert.strictEqual(r.reason, reason, `${msg}: wrong reason`);
};
const sends = (r, reason, msg) => {
    assert.strictEqual(r.onVpn, false, `${msg}: expected to send, stayed silent (${r.reason})`);
    if (reason) assert.strictEqual(r.reason, reason, `${msg}: wrong reason`);
};

// --- the two invisible failures (macOS, unchanged from earlier rounds) -------

test('an ordinary Mac sends — idle utun interfaces are NOT a VPN', () => {
    sends(detectVpn({}, mac(NORMAL_MAC)), 'clear', 'idle utuns');
});

test('Docker running is not a VPN', () => {
    sends(detectVpn({}, mac({ ...NORMAL_MAC, bridge100: DOCKER })), 'clear', 'docker bridge');
});

test('a tunnel carrying traffic stays silent', () => {
    silent(detectVpn({}, mac({ ...NORMAL_MAC, utun4: LIVE_UTUN })), 'tunnel', 'live tunnel');
});

test('a machine-wide proxy stays silent', () => {
    silent(detectVpn({}, mac(NORMAL_MAC, (c, a) => (a[0] === '--proxy' ? 'HTTPSEnable : 1' : ''))), 'proxy', 'proxy');
});

test('the OS reporting a connected VPN stays silent', () => {
    silent(detectVpn({}, mac(NORMAL_MAC, (c, a) => (a[0] === '--nc' ? '* (Connected) x IKEv2' : ''))), 'os-vpn', 'os vpn');
});

test('vpnAllowInterfaces exempts exactly the named interface, nothing else', () => {
    sends(detectVpn({ vpnAllowInterfaces: ['utun4'] }, mac({ ...NORMAL_MAC, utun4: LIVE_UTUN })), 'clear', 'allowed');
    silent(detectVpn({ vpnAllowInterfaces: ['utun4'] }, mac({ ...NORMAL_MAC, utun9: LIVE_UTUN })),
        'tunnel', 'a different interface must still be caught');
});

test('skipOnVpn=false disables the gate entirely', () => {
    sends(detectVpn({ skipOnVpn: false }, mac({ ...NORMAL_MAC, utun4: LIVE_UTUN })), 'disabled', 'gate off');
});

// --- the policy change: a failed check now sends, marked unverified ----------
// Earlier rounds treated "the check could not run" identically to "on VPN" —
// which meant a machine whose check broke went silent forever with nothing to
// notice. This is the actual behavior change Stage 2 makes, on every platform.

test('a check that cannot run now SENDS, marked unverified — not silent forever', () => {
    sends(detectVpn({}, mac(NORMAL_MAC, () => { throw new Error('blocked by policy'); })), 'unverified', 'probe error');
});

test('a genuine detection still wins even if some other check would have failed', () => {
    // The tunnel is found directly from os.networkInterfaces(), which never throws
    // in these fixtures — only the exec-based checks (proxy/os-vpn) can fail, and
    // a real tunnel must still be caught regardless of what they say.
    silent(detectVpn({}, mac({ ...NORMAL_MAC, utun4: LIVE_UTUN }, () => { throw new Error('x'); })),
        'tunnel', 'a real tunnel is not excused by an unrelated failed check');
});

// --- Windows — real `ipconfig` captures, verbatim -----------------------------
//
// Six real CCM team members' machines, five of them genuine same-machine on/off
// pairs. Every "on" capture shows `crosscountrymtg.local` on exactly the adapter
// that appears only while connected; every "off" capture shows it nowhere. Two of
// these six also carry Hyper-V's `vEthernet (Default Switch)` adapter — present
// and unchanged in BOTH states — which is the exact false-positive class the
// earlier interface-shape approach could not tell apart from a real VPN.

// Gaurav — on VPN. Note vEthernet (Default Switch), Hyper-V's own adapter,
// alongside the real VPN adapter; it carries no suffix and must not be caught.
const GAURAV_ON = `
Windows IP Configuration

Ethernet adapter Ethernet 2:

   Connection-specific DNS Suffix  . : crosscountrymtg.local
   IPv4 Address. . . . . . . . . . . : 10.4.15.174
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : ::

Ethernet adapter Ethernet:

   Media State . . . . . . . . . . . : Media disconnected
   Connection-specific DNS Suffix  . :

Wireless LAN adapter Wi-Fi:

   Connection-specific DNS Suffix  . :
   IPv4 Address. . . . . . . . . . . : 192.168.0.182
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 192.168.0.1

Ethernet adapter vEthernet (Default Switch):

   Connection-specific DNS Suffix  . :
   IPv4 Address. . . . . . . . . . . : 172.23.96.1
   Subnet Mask . . . . . . . . . . . : 255.255.240.0
   Default Gateway . . . . . . . . . :
`;

// Gaurav — off VPN, same machine. vEthernet (Default Switch) is unchanged (same
// address, no suffix); only Ethernet 2 (the VPN adapter) is gone entirely.
const GAURAV_OFF = `
Windows IP Configuration

Ethernet adapter Ethernet:

   Media State . . . . . . . . . . . : Media disconnected
   Connection-specific DNS Suffix  . :

Wireless LAN adapter Wi-Fi:

   Connection-specific DNS Suffix  . :
   IPv4 Address. . . . . . . . . . . : 192.168.0.182
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 192.168.0.1

Ethernet adapter vEthernet (Default Switch):

   Connection-specific DNS Suffix  . :
   IPv4 Address. . . . . . . . . . . : 172.23.96.1
   Subnet Mask . . . . . . . . . . . : 255.255.240.0
   Default Gateway . . . . . . . . . :
`;

// pratik.gambhirrao — on VPN.
const PRATIK_ON = `
Ethernet adapter Ethernet 2:

   Connection-specific DNS Suffix  . : crosscountrymtg.local
   IPv4 Address. . . . . . . . . . . : 10.6.15.246
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : ::

Wireless LAN adapter Wi-Fi:

   Connection-specific DNS Suffix  . :
   IPv4 Address. . . . . . . . . . . : 192.168.68.114
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
`;

// pratik.gambhirrao — off VPN, same machine (same Wi-Fi address, 192.168.68.114).
const PRATIK_OFF = `
Wireless LAN adapter Wi-Fi:

   Connection-specific DNS Suffix  . :
   IPv4 Address. . . . . . . . . . . : 192.168.68.114
   Subnet Mask . . . . . . . . . . . : 255.255.255.0

Ethernet adapter Bluetooth Network Connection:

   Media State . . . . . . . . . . . : Media disconnected
   Connection-specific DNS Suffix  . :
`;

// A third person — off VPN, home Wi-Fi with its own (unrelated) DNS suffix.
const IBALL_OFF = `
Wireless LAN adapter Wi-Fi:

   Connection-specific DNS Suffix  . : iball.wifi.net
   IPv4 Address. . . . . . . . . . . : 192.168.1.204
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 192.168.1.1

Ethernet adapter Bluetooth Network Connection:

   Media State . . . . . . . . . . . : Media disconnected
   Connection-specific DNS Suffix  . :
`;

// Same person — on VPN. A different subnet again (10.5.15.x), and Wi-Fi's own
// suffix (iball.wifi.net) present the whole time, unrelated to the VPN.
const IBALL_ON = `
Ethernet adapter Ethernet 2:

   Connection-specific DNS Suffix  . : crosscountrymtg.local
   IPv4 Address. . . . . . . . . . . : 10.5.15.129
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : ::

Wireless LAN adapter Wi-Fi:

   Connection-specific DNS Suffix  . :
   IPv4 Address. . . . . . . . . . . : 192.168.0.102
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 192.168.0.1
`;

// Nirav Parekh — on VPN, a fifth distinct subnet (10.3.30.x, not a .15.x block).
const NIRAV_ON = `
Ethernet adapter Ethernet 2:
   Connection-specific DNS Suffix  . : crosscountrymtg.local
   IPv4 Address. . . . . . . . . . . : 10.3.30.137
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : ::
Wireless LAN adapter Wi-Fi:
   Connection-specific DNS Suffix  . :
   IPv4 Address. . . . . . . . . . . : 192.168.1.6
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 192.168.1.1
`;

// Nirav — off VPN, same machine (same Wi-Fi address, 192.168.1.6).
const NIRAV_OFF = `
Wireless LAN adapter Wi-Fi:
   Connection-specific DNS Suffix  . :
   IPv4 Address. . . . . . . . . . . : 192.168.1.6
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 192.168.1.1
Ethernet adapter Bluetooth Network Connection:
   Media State . . . . . . . . . . . : Media disconnected
   Connection-specific DNS Suffix  . :
`;

const REG_NO_PROXY = 'HKEY_CURRENT_USER\\...\\Internet Settings\r\n    ProxyEnable    REG_DWORD    0x0\r\n';
const REG_PROXY_ON = 'HKEY_CURRENT_USER\\...\\Internet Settings\r\n    ProxyEnable    REG_DWORD    0x1\r\n';

const win = ({ ipconfig = '', reg = REG_NO_PROXY, ipconfigFail = false, regFail = false }) => ({
    platform: () => 'win32',
    ifaces: () => ({}), // not used by the Windows path — kept only for shape parity
    exec: (cmd) => {
        if (cmd === 'ipconfig') {
            if (ipconfigFail) throw new Error('ipconfig blocked');
            return ipconfig;
        }
        if (cmd === 'reg') {
            if (regFail) throw new Error('reg blocked');
            return reg;
        }
        return '';
    },
    env: () => ({}),
});

test('WINDOWS (Gaurav, real capture): on VPN — caught, Hyper-V adapter alongside it ignored', () => {
    silent(detectVpn({}, win({ ipconfig: GAURAV_ON })), 'tunnel', 'gaurav on vpn');
});

test('WINDOWS (Gaurav, real capture): off VPN, same machine — sends; Hyper-V adapter unchanged, still ignored', () => {
    sends(detectVpn({}, win({ ipconfig: GAURAV_OFF })), 'clear', 'gaurav off vpn');
});

test('WINDOWS (pratik.gambhirrao, real capture): on VPN — caught', () => {
    silent(detectVpn({}, win({ ipconfig: PRATIK_ON })), 'tunnel', 'pratik on vpn');
});

test('WINDOWS (pratik.gambhirrao, real capture): off VPN, same machine — sends', () => {
    sends(detectVpn({}, win({ ipconfig: PRATIK_OFF })), 'clear', 'pratik off vpn');
});

test('WINDOWS (real capture): off VPN, home Wi-Fi with its own unrelated suffix — sends', () => {
    sends(detectVpn({}, win({ ipconfig: IBALL_OFF })), 'clear', 'iball off vpn');
});

test('WINDOWS (same machine, real capture): on VPN — caught despite an unrelated Wi-Fi suffix being present throughout', () => {
    silent(detectVpn({}, win({ ipconfig: IBALL_ON })), 'tunnel', 'iball on vpn');
});

test('WINDOWS (Nirav Parekh, real capture): on VPN, a fifth distinct subnet — still caught on the suffix alone', () => {
    silent(detectVpn({}, win({ ipconfig: NIRAV_ON })), 'tunnel', 'nirav on vpn');
});

test('WINDOWS (Nirav Parekh, real capture): off VPN, same machine — sends', () => {
    sends(detectVpn({}, win({ ipconfig: NIRAV_OFF })), 'clear', 'nirav off vpn');
});

test('WINDOWS: a disconnected adapter with a leftover-looking suffix line but no address is not counted', () => {
    // Guards the "must be active" qualifier in activeDnsSuffixes: a suffix without
    // an IPv4 Address on the same block must not trigger, matching what every real
    // disconnected-adapter block in the captures above actually looks like (blank).
    const ipconfig = `
Ethernet adapter Ethernet 2:

   Media State . . . . . . . . . . . : Media disconnected
   Connection-specific DNS Suffix  . : crosscountrymtg.local
`;
    sends(detectVpn({}, win({ ipconfig })), 'clear', 'suffix present but adapter idle');
});

test('WINDOWS: a configured proxy stays silent, independent of the suffix check', () => {
    silent(detectVpn({}, win({ ipconfig: GAURAV_OFF, reg: REG_PROXY_ON })), 'proxy', 'windows proxy');
});

test('WINDOWS: ipconfig failing now SENDS, marked unverified — not silent forever', () => {
    sends(detectVpn({}, win({ ipconfigFail: true })), 'unverified', 'ipconfig blocked');
});

test('WINDOWS: the registry check failing also SENDS, marked unverified', () => {
    sends(detectVpn({}, win({ ipconfig: GAURAV_OFF, regFail: true })), 'unverified', 'reg blocked');
});

test('WINDOWS: a genuine detection still wins even if the (unrelated) registry check would have failed', () => {
    silent(detectVpn({}, win({ ipconfig: GAURAV_ON, regFail: true })), 'tunnel', 'real VPN not excused by an unrelated failure');
});

// --- activeDnsSuffixes parsing, directly ---------------------------------------

test('activeDnsSuffixes: only suffixes on adapters carrying an IPv4 address are returned', () => {
    assert.deepStrictEqual(activeDnsSuffixes(GAURAV_ON), ['crosscountrymtg.local']);
    assert.deepStrictEqual(activeDnsSuffixes(GAURAV_OFF), []);
});

// --- privacy -----------------------------------------------------------------

test('the verdict leaks nothing about the machine', () => {
    const r = detectVpn({}, mac({ ...NORMAL_MAC, utun4: LIVE_UTUN }));
    assert.deepStrictEqual(Object.keys(r).sort(), ['onVpn', 'reason'], 'unexpected fields on the verdict');
    const blob = JSON.stringify(r);
    for (const leak of ['utun4', '10.55.3.9', '192.168.1.72', '72:65:f7', 'en0', 'bridge', 'crosscountrymtg']) {
        assert.ok(!blob.includes(leak), `verdict leaked "${leak}": ${blob}`);
    }
    assert.ok(['tunnel', 'proxy', 'os-vpn', 'unverified', 'clear', 'disabled'].includes(r.reason),
        `reason must be a fixed word, got "${r.reason}"`);
});

test('probeOnce: exactly one machine probe, whether or not --explain is requested', () => {
    let execCalls = 0;
    const counting = {
        platform: () => 'win32',
        ifaces: () => ({}),
        exec: (cmd) => {
            execCalls++;
            if (cmd === 'ipconfig') return GAURAV_ON;
            if (cmd === 'reg') return REG_NO_PROXY;
            return '';
        },
        env: () => ({}),
    };
    const { verdict, snap, ifaces } = probeOnce({}, counting);
    assert.strictEqual(verdict.onVpn, true, 'expected a tunnel verdict from the shared fixture');
    // One gather() = 2 calls (ipconfig, reg). The regression this guards is a
    // SECOND gather() for the explanation — this must stay at 2, never double to 4.
    assert.strictEqual(execCalls, 2,
        `probeOnce should gather exactly once (2 calls), saw ${execCalls} — a second gather() crept back in`);
    const e = explainFromSnapshot(snap, ifaces);
    assert.strictEqual(e.ccmVpn, verdict.onVpn, 'explain and the verdict it explains came from different data');
});

// --- run ---------------------------------------------------------------------

let failed = 0;
for (const [name, fn] of cases) {
    try {
        fn();
        passed++;
        console.log(`  ok   ${name}`);
    } catch (e) {
        failed++;
        console.error(`  FAIL ${name}\n       ${e.message}`);
    }
}
console.log(`\n${passed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
