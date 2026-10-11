# Remove the Claude Usage Collector from Windows: deletes the scheduled task and
# local config/outbox. Safe to run more than once.
#
#   powershell -ExecutionPolicy Bypass -File uninstall-windows.ps1
$ErrorActionPreference = "SilentlyContinue"
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
# setup.js --reset removes BOTH triggers (scheduled task + session hook) and the
# local state, so there is one uninstall path rather than two that can disagree.
$node = (Get-Command node -ErrorAction SilentlyContinue)
if ($node -and (Test-Path (Join-Path $Dir "setup.js"))) {
  & $node.Source (Join-Path $Dir "setup.js") --reset
} else {
  # Fallback for a machine where node or setup.js has already gone.
  Unregister-ScheduledTask -TaskName "LensClaudeUsageCollector" -Confirm:$false | Out-Null
  Remove-Item -Force (Join-Path $Dir "config.json") | Out-Null
  Remove-Item -Force (Join-Path $Dir "outbox.json") | Out-Null
  Remove-Item -Force (Join-Path $Dir "dashboard.html") | Out-Null
  Write-Host "Uninstalled (fallback path): scheduled task removed and local config deleted."
}
Write-Host "Tip: also click Disable in Lens > My Claude Report to revoke the token."
