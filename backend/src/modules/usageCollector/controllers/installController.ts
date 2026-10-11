/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import { config } from '../../../config';

/**
 * Public installer endpoints. These are STREAMED (curl | bash / iwr | iex), so no
 * file is written-then-launched by Finder — macOS Gatekeeper never triggers and
 * there is no quarantine to clear. They contain NO secrets; the ingest token is
 * supplied by the user as an argument.
 */

function sendFile(res: Response, rel: string, contentType: string) {
    const file = path.join(config.collector.sourceDir, rel);
    if (!fs.existsSync(file)) return res.status(404).send('not found');
    res.type(contentType);
    fs.createReadStream(file).pipe(res);
}

// The bash installer, generated inline so it always points back at this server for
// the raw files. Kept short + inspectable (open the URL to read it).
const INSTALL_SH = `#!/usr/bin/env bash
# Claude Usage Collector — one-line installer (no admin, no Gatekeeper prompt).
#
# Installs BOTH triggers: a real OS schedule (weekdays) so you report every working
# day even if you never open Claude Code, plus a session-end hook for freshness.
# Re-running is safe, and --token may be omitted once config.json exists — that is
# the upgrade path for machines installed before the scheduler existed.
#
# Usage: curl -fsSL <lens>/api/collector/install.sh | bash -s -- --token <clct_...> --url <lens> [--dir DIR] [--no-hook] [--no-schedule]
set -euo pipefail
TOKEN=""; URL=""; DIR="$HOME/claude-usage-collector"; HOOK=1; SCHED=1
while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2;;
    --url)   URL="$2"; shift 2;;
    --dir)   DIR="$2"; shift 2;;
    --no-hook) HOOK=0; shift;;
    --no-schedule) SCHED=0; shift;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done
[ -n "$URL" ] || { echo "Need --url"; exit 1; }
if [ -z "$TOKEN" ] && [ ! -f "$DIR/config.json" ]; then
  echo "Need --token for a first install (get it from Lens > My Claude Report)."; exit 1
fi
command -v node >/dev/null 2>&1 || { echo "Node.js not found (it ships with Claude Code). Install Node and retry."; exit 1; }
mkdir -p "$DIR"
# Keep the version being replaced. Without this nothing on the machine can be put
# back, and every rollback has to go through the server first — the wrong
# dependency when the machine in question is the one misbehaving.
for f in collector.js setup.js vpn.js; do
  [ -f "$DIR/$f" ] && cp "$DIR/$f" "$DIR/$f.bak"
done
echo "Downloading collector into $DIR ..."
curl -fsSL "$URL/api/collector/collector.js" -o "$DIR/collector.js"
curl -fsSL "$URL/api/collector/setup.js"     -o "$DIR/setup.js"
# The VPN gate. Fetched before anything runs: without it the collector treats
# itself as being on a VPN and stays silent, so a failure here is safe but total.
curl -fsSL "$URL/api/collector/vpn.js"       -o "$DIR/vpn.js"
if [ -n "$TOKEN" ]; then
  cat > "$DIR/config.json" <<JSON
{ "lensBaseUrl": "$URL", "ingestToken": "$TOKEN", "enabled": true }
JSON
  chmod 600 "$DIR/config.json" 2>/dev/null || true
else
  echo "Keeping your existing config.json (no --token given)."
fi
FLAGS=""
[ "$HOOK" = "1" ] && FLAGS="$FLAGS --hook"
[ "$SCHED" = "1" ] && FLAGS="$FLAGS --schedule"
[ -n "$FLAGS" ] && node "$DIR/setup.js" $FLAGS || true
echo "Pushing your first report ..."
node "$DIR/collector.js" || true
# Report what is ACTUALLY driving reports, read back from the OS -- never an
# unconditional "it will keep reporting automatically" that nothing verified.
node "$DIR/setup.js" --status || true
echo "Remove anytime: node \\"$DIR/setup.js\\" --reset"
`;

// PowerShell installer. Usage:
//   $env:CLCT_TOKEN='clct_...'; $env:CLCT_URL='https://lens..'; iwr <lens>/api/collector/install.ps1 | iex
const INSTALL_PS1 = `# Claude Usage Collector — one-line installer (no admin).
#
# Installs BOTH triggers: a per-user Scheduled Task (weekdays, no admin needed) so
# you report every working day even if you never open Claude Code, plus a
# session-end hook for freshness. Re-running is safe, and CLCT_TOKEN may be omitted
# once config.json exists — that is the upgrade path for older installs.
#
# Usage:
#   $env:CLCT_TOKEN='clct_...'; $env:CLCT_URL='https://lens..'; irm <lens>/api/collector/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$Token = $env:CLCT_TOKEN; $Url = $env:CLCT_URL
$Dir = if ($env:CLCT_DIR) { $env:CLCT_DIR } else { Join-Path $HOME 'claude-usage-collector' }
$Cfg = Join-Path $Dir 'config.json'
if (-not $Url) { Write-Error 'Set $env:CLCT_URL first.'; return }
if (-not $Token -and -not (Test-Path $Cfg)) { Write-Error 'Set $env:CLCT_TOKEN for a first install (get it from Lens > My Claude Report).'; return }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'Node.js not found (ships with Claude Code).'; return }
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
# Keep the version being replaced, so this machine can be rolled back on its own
# without waiting for the server to be reverted first.
foreach ($f in 'collector.js','setup.js','vpn.js') {
  $p = Join-Path $Dir $f
  if (Test-Path $p) { Copy-Item $p "$p.bak" -Force }
}
Write-Host "Downloading collector into $Dir ..."
Invoke-WebRequest "$Url/api/collector/collector.js" -OutFile (Join-Path $Dir 'collector.js')
Invoke-WebRequest "$Url/api/collector/setup.js"     -OutFile (Join-Path $Dir 'setup.js')
# The VPN gate. Without it the collector treats itself as being on a VPN and stays
# silent, so a failure here is safe but total.
Invoke-WebRequest "$Url/api/collector/vpn.js"       -OutFile (Join-Path $Dir 'vpn.js')
if ($Token) {
  @{ lensBaseUrl = $Url; ingestToken = $Token; enabled = $true } | ConvertTo-Json | Set-Content $Cfg
} else {
  Write-Host 'Keeping your existing config.json (no CLCT_TOKEN given).'
}
node (Join-Path $Dir 'setup.js') --hook --schedule
Write-Host "Pushing your first report ..."
node (Join-Path $Dir 'collector.js')
# Report what is ACTUALLY driving reports, read back from Task Scheduler.
node (Join-Path $Dir 'setup.js') --status
Write-Host "Remove anytime: run  node setup.js --reset  in $Dir"
`;

export const installController = {
    installSh(_req: Request, res: Response) {
        res.type('text/x-shellscript').send(INSTALL_SH);
    },
    installPs1(_req: Request, res: Response) {
        res.type('text/plain').send(INSTALL_PS1);
    },
    collectorJs(_req: Request, res: Response) {
        sendFile(res, 'collector.js', 'application/javascript');
    },
    setupJs(_req: Request, res: Response) {
        sendFile(res, 'setup.js', 'application/javascript');
    },
    vpnJs(_req: Request, res: Response) {
        sendFile(res, 'vpn.js', 'application/javascript');
    },
};
