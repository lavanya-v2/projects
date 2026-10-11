#!/usr/bin/env node
// Build a fake ~/.claude/projects tree with transcripts on chosen days, so day
// selection can be driven deterministically instead of waiting for real dates.
// Usage: node fixture.js <projectsDir> <YYYY-MM-DD> [...]
'use strict';
const fs = require('fs');
const path = require('path');

const [, , projectsDir, ...days] = process.argv;
fs.rmSync(projectsDir, { recursive: true, force: true });

days.forEach((day, i) => {
    const dir = path.join(projectsDir, `-Users-tester-proj${i}`);
    fs.mkdirSync(dir, { recursive: true });
    // Local-noon timestamps so the machine-local calendar date is unambiguous.
    const iso = (h, mn) => new Date(`${day}T${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}:00`).toISOString();
    const lines = [];
    for (let n = 0; n < 3; n++) {
        lines.push(JSON.stringify({
            type: 'user',
            timestamp: iso(12, n),
            sessionId: `sess-${day}-${n}`,
            cwd: `/Users/tester/proj${i}`,
            message: { role: 'user', content: [{ type: 'text', text: `please refactor the ${n} handler and explain why it failed` }] },
        }));
        lines.push(JSON.stringify({
            type: 'assistant',
            timestamp: iso(12, n),
            message: {
                role: 'assistant',
                model: 'claude-opus-4-8',
                usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
                content: [{ type: 'text', text: 'ok' }],
            },
        }));
    }
    fs.writeFileSync(path.join(dir, `${day}.jsonl`), lines.join('\n') + '\n');
});
console.log(`fixture: ${days.length} day(s) -> ${projectsDir}`);
