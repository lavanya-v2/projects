#!/usr/bin/env node
/**
 * extractPromptText — per-block synthetic-prefix filtering.
 *
 * Regression test for a real bug: VS Code injects an <ide_opened_file>/
 * <ide_selection> tag as its own leading content block, ahead of the person's
 * real typed instruction, in the SAME turn. extractPromptText used to join every
 * block first and then check whether the JOINED string started with a synthetic
 * prefix — so any turn carrying an IDE tag had its entire record discarded, tag
 * AND the real instruction, never counted in prompts.total. Run: `node
 * test-extract-prompt-text.js` (exit 0 = pass).
 */
'use strict';
const assert = require('assert');
const { extractPromptText } = require('./collector');

const rec = (...textBlocks) => ({
    message: { role: 'user', content: textBlocks.map((text) => ({ type: 'text', text })) },
});

// 1. IDE tag + real instruction on the same turn — the exact shape VS Code sends.
//    The real instruction must survive; the tag must not.
const withIdeTag = rec(
    '<ide_opened_file>The user opened the file /Users/x/repo/backend/.env in the IDE. This may or may not be related to the current task.</ide_opened_file>',
    'Check the graph, it looks ugly, can we redesign this?',
);
assert.strictEqual(
    extractPromptText(withIdeTag),
    'Check the graph, it looks ugly, can we redesign this?',
    'the real instruction after an IDE tag must be extracted, not discarded',
);

// 2. IDE tag alone, no real instruction block — still null (nothing real to score).
const ideTagOnly = rec(
    '<ide_selection>The user selected lines 10-20 from /Users/x/repo/App.tsx. This may or may not be related to the current task.</ide_selection>',
);
assert.strictEqual(extractPromptText(ideTagOnly), null, 'an IDE tag with no real content must still be null');

// 3. A plain instruction, no synthetic blocks at all — unaffected by the fix.
const plain = rec('why does auth.ts:42 throw a 401?');
assert.strictEqual(extractPromptText(plain), 'why does auth.ts:42 throw a 401?', 'a plain prompt must be unaffected');

// 4. Multiple synthetic blocks bracketing one real block — only the real one survives.
const sandwiched = rec(
    '<system-reminder>some harness note</system-reminder>',
    'fix the null check in parseInt',
    '<local-command-stdout>ok</local-command-stdout>',
);
assert.strictEqual(
    extractPromptText(sandwiched),
    'fix the null check in parseInt',
    'a real block between synthetic ones must survive on its own',
);

// 5. A record that really is entirely synthetic (multiple synthetic blocks, no real
//    content at all) must still return null — the fix must not start treating
//    synthetic-only turns as real.
const allSynthetic = rec(
    '<ide_opened_file>opened .env</ide_opened_file>',
    '<system-reminder>compact summary</system-reminder>',
);
assert.strictEqual(extractPromptText(allSynthetic), null, 'an all-synthetic turn must still be null');

console.log('extractPromptText test: PASS — synthetic blocks are dropped individually, not the whole turn');
