# Install the Claude Usage Collector on Windows: writes config.json and registers
# a daily Task Scheduler job. Requires Node (already present if you run Claude Code).
#
#   powershell -ExecutionPolicy Bypass -File install-windows.ps1 -Token clct_xxx -Url https://lens.your-company.internal
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [Parameter(Mandatory = $true)][string]$Url,
  [int]$Hour = 18
)

$ErrorActionPreference = "Stop"
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path

$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) {
  Write-Error "Node.js not found. Install Node (it ships with Claude Code) and retry."
  exit 1
}
$NodePath = $node.Source

# One implementation of scheduling lives in setup.js -- it is the file the streamed
# one-line installer downloads, so implementing it here too would drift from what
# most people actually get. setup.js registers a per-user task from XML (no admin)
# with the battery defaults overridden, which New-ScheduledTaskSettingsSet cannot do.
& $NodePath (Join-Path $Dir "setup.js") --token $Token --url $Url --hook --schedule --at "13:05,$($Hour):05"

Write-Host "Installed. Running once now to verify..."
& $NodePath (Join-Path $Dir "collector.js")
& $NodePath (Join-Path $Dir "setup.js") --status
Write-Host "Uninstall anytime with: node setup.js --reset"
