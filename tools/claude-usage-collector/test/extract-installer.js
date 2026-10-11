#!/usr/bin/env node
/**
 * Pull the INSTALL_SH text out of installController.ts so the suite can run the
 * EXACT script members are served, rather than a hand-copied approximation that
 * would drift from it. Drift between the shipped installer and what was tested is
 * precisely how the scheduler went missing in the first place.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ctrl = path.join(__dirname, '..', '..', '..', 'backend', 'src', 'modules',
    'usageCollector', 'controllers', 'installController.ts');
const src = fs.readFileSync(ctrl, 'utf8');
const m = /const INSTALL_SH = `([\s\S]*?)\n`;/.exec(src);
if (!m) { console.error('INSTALL_SH not found in installController.ts'); process.exit(1); }

// The TS template literal escapes \" for the embedded shell quotes; undo that.
process.stdout.write(m[1].replace(/\\"/g, '"').replace(/\\`/g, '`').replace(/\\\$/g, '$'));
