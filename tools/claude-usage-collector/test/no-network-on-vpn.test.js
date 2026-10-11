#!/usr/bin/env node
'use strict';
/**
 * The guarantee, asserted directly: while a VPN is detected, NOTHING reaches the
 * network — not a socket, not even a DNS lookup.
 *
 * WHY THIS EXISTS SEPARATELY from vpn.test.js: that file proves the gate decides
 * correctly. This one proves the collector actually obeys it. They are different
 * failures, and this is the one that gets reintroduced by a later edit — someone
 * adds a version check, a heartbeat, or a config fetch above the gate, everything
 * still "works", and reports start leaving customer networks again with nothing
 * to show for it.
 *
 * The method: run the collector in a child process with dns.lookup, dns.resolve
 * and Socket.connect replaced by functions that kill the process. If the gate
 * holds, the child exits 0 having sent nothing. The control case deliberately
 * opens the gate and asserts the child DOES die — without that, a broken guard
 * would let this test pass while checking nothing at all.
 *
 * Run: node test/no-network-on-vpn.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const NET_TRIPWIRE_EXIT = 97;

const rig = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-gate-'));
const cleanup = () => { try { fs.rmSync(rig, { recursive: true, force: true }); } catch { /* best effort */ } };

// A preload that makes any network activity fatal and unmistakable.
fs.writeFileSync(path.join(rig, 'tripwire.js'), `
const dns = require('dns');
const net = require('net');
const boom = (what) => { console.error('NETWORK ACTIVITY: ' + what); process.exit(${NET_TRIPWIRE_EXIT}); };
for (const m of ['lookup', 'resolve', 'resolve4', 'resolve6']) {
  dns[m] = () => boom('dns.' + m);
  if (dns.promises) dns.promises[m] = () => boom('dns.promises.' + m);
}
net.Socket.prototype.connect = function () { boom('socket.connect'); };
`);

fs.copyFileSync(path.join(ROOT, 'collector.js'), path.join(rig, 'collector.js'));

// A host that could only be reached by resolving it first, so a DNS lookup alone
// trips the wire even if the connection would have failed anyway.
fs.writeFileSync(path.join(rig, 'config.json'), JSON.stringify({
    lensBaseUrl: 'https://lens.test.invalid',
    ingestToken: 'clct_test_token',
    enabled: true,
}));

// Something definitely waiting to be sent, so "sent nothing" is a real result
// rather than "had nothing to send".
const QUEUED_DAY = '2026-08-19';
fs.writeFileSync(path.join(rig, 'outbox.json'), JSON.stringify([{
    schemaVersion: 3, day: QUEUED_DAY, collectorVersion: '1.4.0',
    orgUuid: null, orgName: null, prompts: { total: 1, scored: 1, acks: 0 },
}]));

const setGate = (onVpn) => fs.writeFileSync(path.join(rig, 'vpn.js'),
    `module.exports = { detectVpn: () => ({ onVpn: ${onVpn}, reason: '${onVpn ? 'tunnel' : 'clear'}' }) };`);

const run = () => cp.spawnSync(process.execPath,
    ['-r', path.join(rig, 'tripwire.js'), path.join(rig, 'collector.js'), '--days', '1'],
    { encoding: 'utf8', timeout: 30000 });

let failed = 0;
const check = (name, fn) => {
    try { fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.message}`); }
};

check('on a VPN, the collector touches the network zero times', () => {
    setGate(true);
    const r = run();
    assert.notStrictEqual(r.status, NET_TRIPWIRE_EXIT,
        `the collector reached the network while on a VPN:\n${r.stderr}`);
    assert.strictEqual(r.status, 0, `expected a clean exit, got ${r.status}\n${r.stderr}`);
    assert.ok(/VPN detected/.test(r.stdout), `expected a VPN notice, got:\n${r.stdout}`);
});

check('the queued day is kept, not dropped', () => {
    const outbox = JSON.parse(fs.readFileSync(path.join(rig, 'outbox.json'), 'utf8'));
    assert.ok(outbox.some((p) => p.day === QUEUED_DAY),
        'the deferred day vanished from the outbox — suppressed must mean queued, never discarded');
});

check('the throttle stamp is NOT burned by a suppressed run', () => {
    // Otherwise a deferred hook run costs the machine its next 12 hours, turning a
    // short VPN session into a lost day.
    assert.ok(!fs.existsSync(path.join(rig, '.last-run')),
        '.last-run was written despite nothing being sent');
});

check('a network call added ABOVE the gate is blocked, even off VPN', () => {
    // The failure this guards against is not in today's code — it is the edit
    // someone makes in six months. A version check or heartbeat near the top of
    // main() would emit a DNS query from inside a customer network while every
    // other test still passed and the collector still refused to send reports.
    //
    // installNetworkLock() turns that from a silent leak into an immediate,
    // loud failure. This asserts the lock is actually installed and actually
    // bites — with the gate OPEN, so it is the lock being tested and not the gate.
    const withEarlyCall = path.join(rig, 'collector-early-call.js');
    const src = fs.readFileSync(path.join(rig, 'collector.js'), 'utf8');
    const anchor = 'const netLock = installNetworkLock();';
    assert.ok(src.includes(anchor), 'network lock is no longer installed at the top of main()');
    fs.writeFileSync(withEarlyCall, src.replace(anchor,
        `${anchor}\n    require('https').get('https://lens.test.invalid/version', () => {});`));

    setGate(false); // gate open — nothing but the lock can stop this
    const r = cp.spawnSync(process.execPath, [withEarlyCall, '--days', '1'],
        { encoding: 'utf8', timeout: 30000 });
    assert.match(String(r.stderr), /before the VPN check/,
        `a network call above the gate was NOT blocked — the lock is not protecting this file.\n${r.stderr}`);
    assert.notStrictEqual(r.status, 0, 'a lock violation must fail the run, not pass quietly');
});

check('CONTROL: with the gate open the tripwire does fire', () => {
    // Without this, a broken tripwire would make every assertion above vacuous.
    setGate(false);
    const r = run();
    assert.strictEqual(r.status, NET_TRIPWIRE_EXIT,
        `the tripwire did not fire with the gate open (exit ${r.status}) — the test above proves nothing`);
});

cleanup();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
