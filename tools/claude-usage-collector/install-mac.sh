#!/usr/bin/env bash
# Install the Claude Usage Collector on macOS: writes config.json and registers a
# daily launchd job. Requires Node (already present if you run Claude Code).
#
#   ./install-mac.sh --token clct_xxx --url https://lens.your-company.internal
set -euo pipefail

TOKEN=""
URL=""
HOUR="${HOUR:-18}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2;;
    --url)   URL="$2"; shift 2;;
    --hour)  HOUR="$2"; shift 2;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

if [[ -z "$TOKEN" || -z "$URL" ]]; then
  echo "Usage: ./install-mac.sh --token <clct_...> --url <lens-base-url> [--hour 18]"; exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Install Node (it ships with Claude Code) and retry."; exit 1
fi

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
NODE_BIN="$(command -v node)"

# One implementation of scheduling lives in setup.js -- it is the file the streamed
# one-line installer downloads, so anything implemented here instead would only
# reach people who took the manual zip route and would drift from what they get.
node "$DIR/setup.js" --token "$TOKEN" --url "$URL" --hook --schedule --at "13:05,${HOUR}:05"

echo "Installed. Running once now to verify..."
"$NODE_BIN" "$DIR/collector.js" || true
node "$DIR/setup.js" --status
echo "Uninstall anytime with: node \"$DIR/setup.js\" --reset"
