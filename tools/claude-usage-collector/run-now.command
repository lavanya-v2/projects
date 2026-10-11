#!/bin/bash
# Double-click in Finder to push your latest Claude usage to Lens right now.
# No admin needed. (Requires config.json — run setup.js first.)
cd "$(dirname "$0")"
node collector.js
echo ""
echo "Done. You can close this window."
