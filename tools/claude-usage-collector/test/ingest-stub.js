#!/usr/bin/env node
// Stand-in for the Lens ingest endpoint. Records every POST so a test can assert
// what actually left the machine. Never touches production.
'use strict';
const http = require('http');
const fs = require('fs');

const port = Number(process.argv[2] || 8799);
const outFile = process.argv[3] || 'received.json';
const got = [];

const path = require('path');
const SRC = path.join(__dirname, '..');

http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
        // Serve the real collector/setup files so the shipped one-line installer can
        // be exercised verbatim, not a paraphrase of it.
        const m = /^\/api\/collector\/(collector\.js|setup\.js)$/.exec(req.url || '');
        if (m && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/javascript' });
            return res.end(fs.readFileSync(path.join(SRC, m[1])));
        }
        if (req.url === '/api/ingest/claude-usage' && req.method === 'POST') {
            try { got.push({ auth: req.headers.authorization || '', payload: JSON.parse(body) }); } catch { /* ignore */ }
            fs.writeFileSync(outFile, JSON.stringify(got, null, 2));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end('{"ok":true}');
        }
        res.writeHead(404); res.end('nope');
    });
}).listen(port, () => console.log(`ingest stub on ${port} -> ${outFile}`));
