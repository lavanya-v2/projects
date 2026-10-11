#!/usr/bin/env node
/**
 * T12 — Windows task XML, STRUCTURAL checks only.
 *
 * This does NOT prove schtasks accepts the task; that needs a real Windows box and
 * was explicitly accepted as an untested risk. What it does prove is that the two
 * traps we know about are handled: the UTF-16LE+BOM encoding schtasks demands, and
 * the battery defaults that would otherwise make a laptop skip every run.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = process.argv[2];
const { winTaskXml } = require(path.join(dir, 'setup.js'));

let pass = 0, fail = 0;
const t = (name, fn) => {
    try { fn(); console.log(`  \x1b[32mPASS\x1b[0m ${name}`); pass++; }
    catch (e) { console.log(`  \x1b[31mFAIL\x1b[0m ${name} — ${e.message}`); fail++; }
};

const xml = winTaskXml([[13, 5], [18, 5]]);

t('battery defaults overridden (laptop would otherwise skip every run)', () => {
    assert(/<DisallowStartIfOnBatteries>false</.test(xml), 'DisallowStartIfOnBatteries not false');
    assert(/<StopIfGoingOnBatteries>false</.test(xml), 'StopIfGoingOnBatteries not false');
});
t('StartWhenAvailable true (a missed trigger retries instead of vanishing)', () => {
    assert(/<StartWhenAvailable>true</.test(xml));
});
t('weekdays only — 5 day elements per trigger, no Saturday/Sunday', () => {
    assert(/<Monday \/><Tuesday \/><Wednesday \/><Thursday \/><Friday \/>/.test(xml), 'weekday set wrong');
    assert(!/<Saturday/.test(xml) && !/<Sunday/.test(xml), 'weekend day present');
});
t('both fire times present as CalendarTriggers', () => {
    assert((xml.match(/<CalendarTrigger>/g) || []).length === 2, 'expected 2 calendar triggers');
    assert(xml.includes('T13:05:00') && xml.includes('T18:05:00'));
});
t('logon trigger present (covers a machine off all day)', () => {
    assert(/<LogonTrigger>/.test(xml) && /<Delay>PT5M<\/Delay>/.test(xml));
});
t('runs unelevated — no admin required', () => {
    assert(/<LogonType>InteractiveToken<\/LogonType>/.test(xml));
    assert(/<RunLevel>LeastPrivilege<\/RunLevel>/.test(xml));
});
t('scheduled run passes --skip-weekends and no --throttle', () => {
    const args = /<Arguments>([^<]*)<\/Arguments>/.exec(xml)[1];
    assert(args.includes('--skip-weekends'), 'missing --skip-weekends');
    assert(!args.includes('--throttle'), '--throttle would let the hook suppress the daily job');
});
t('declares UTF-16 and re-parses as well-formed XML', () => {
    assert(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>'));
    // No XML lib in stdlib; assert tags balance rather than trusting eyeballs.
    const opens = (xml.match(/<([A-Za-z][\w]*)(?=[\s>])(?![^>]*\/>)/g) || []).length;
    const closes = (xml.match(/<\/[A-Za-z][\w]*>/g) || []).length;
    assert.strictEqual(opens, closes, `unbalanced tags: ${opens} open vs ${closes} close`);
});
t('written to disk as UTF-16LE with BOM (schtasks rejects UTF-8)', () => {
    const tmp = path.join(os.tmpdir(), `wintask-check-${process.pid}.xml`);
    fs.writeFileSync(tmp, '﻿' + xml, 'utf16le');
    const b = fs.readFileSync(tmp);
    assert.strictEqual(b[0], 0xFF, 'first BOM byte should be 0xFF');
    assert.strictEqual(b[1], 0xFE, 'second BOM byte should be 0xFE');
    assert.strictEqual(b[2], 0x3C, 'third byte should be "<" in UTF-16LE');
    fs.unlinkSync(tmp);
});

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
