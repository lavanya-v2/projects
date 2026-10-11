#!/usr/bin/env bash
# Remove the Claude Usage Collector from macOS: unloads the launchd job and
# deletes the local config/outbox. Safe to run more than once.
set -euo pipefail
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LABEL="com.lens.claude-usage-collector"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# setup.js --reset removes BOTH triggers (daily job + session hook) and the local
# state, so there is one uninstall path rather than two that can disagree.
if command -v node >/dev/null 2>&1 && [ -f "$DIR/setup.js" ]; then
  node "$DIR/setup.js" --reset
else
  # Fallback for a machine where node or setup.js has already gone.
  launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST" "$DIR/config.json" "$DIR/outbox.json" "$DIR/dashboard.html" "$DIR/schedule.log"
  echo "Uninstalled (fallback path): launchd job removed and local config deleted."
fi
echo "Tip: also click Disable in Lens > My Claude Report to revoke the token."
