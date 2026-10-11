#!/usr/bin/env bash
# Simulation suite for the collector scheduler.
#
# Everything runs in a scratch HOME so the real install is untouched, and all
# pushes go to a local stub so nothing reaches production. The launchd tests DO
# register a real user LaunchAgent -- that is the point, proving launchd actually
# fires it -- and the suite restores prior state on exit.
set -uo pipefail

SIM="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
SB="$SIM/sandbox"; HOMEDIR="$SB/home"; DIR="$HOMEDIR/claude-usage-collector"
PORT=8799
LABEL=com.lens.claude-usage-collector
REAL_PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BACKUP="$SIM/real-plist.backup"

pass=0; fail=0
ok(){ printf '  \033[32mPASS\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail+1)); }
check(){ if [ "$1" = "0" ]; then ok "$2"; else bad "$2"; fi; }
no(){ if [ "$1" != "0" ]; then ok "$2"; else bad "$2"; fi; }
# Substring tests via `case`, never `... | grep -q`: under `set -o pipefail` a
# matching grep -q exits early, SIGPIPEs the producer, and the pipeline returns
# 141 -- so a successful match reads as a failure. Bit us once already.
contains(){ case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
has(){   if contains "$1" "$2"; then ok "$3"; else bad "$3"; fi; }
hasnt(){ if contains "$1" "$2"; then bad "$3"; else ok "$3"; fi; }
hdr(){ printf '\n\033[1m%s\033[0m\n' "$1"; }

cleanup(){
  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
  rm -f "$REAL_PLIST"
  if [ -f "$BACKUP" ]; then mkdir -p "$HOME/Library/LaunchAgents"; cp "$BACKUP" "$REAL_PLIST"; echo "  (restored pre-existing plist)"; fi
  kill "${STUB_PID:-0}" 2>/dev/null || true
}
trap cleanup EXIT
[ -f "$REAL_PLIST" ] && cp "$REAL_PLIST" "$BACKUP" && echo "backed up existing plist"

rm -rf "$SB"; mkdir -p "$DIR" "$HOMEDIR/Library/LaunchAgents"
cp "$SRC/collector.js" "$SRC/setup.js" "$DIR/"

node "$SIM/ingest-stub.js" "$PORT" "$SIM/received.json" >/dev/null 2>&1 &
STUB_PID=$!; sleep 1

# Anchors computed from a known-past Monday so the suite never rots.
MON=$(date -v-mon -v-7d +%Y-%m-%d)
THU=$(date -j -f %Y-%m-%d -v+3d "$MON" +%Y-%m-%d)
FRI=$(date -j -f %Y-%m-%d -v+4d "$MON" +%Y-%m-%d)
SAT=$(date -j -f %Y-%m-%d -v+5d "$MON" +%Y-%m-%d)
SUN=$(date -j -f %Y-%m-%d -v+6d "$MON" +%Y-%m-%d)
NEXTMON=$(date -j -f %Y-%m-%d -v+7d "$MON" +%Y-%m-%d)
echo "anchors: Thu=$THU Fri=$FRI Sat=$SAT Sun=$SUN Mon=$NEXTMON"

run(){ ( cd "$DIR" && HOME="$HOMEDIR" node "$@" ) 2>&1; }

hdr "T1  fresh install: config + both triggers, self-verified"
node "$SIM/fixture.js" "$HOMEDIR/.claude/projects" "$THU" "$FRI" >/dev/null
OUT=$(run setup.js --token clct_simtoken --url "http://127.0.0.1:$PORT" --hook --schedule)
echo "$OUT" | sed 's/^/      | /'
[ -f "$DIR/config.json" ]; check $? "config.json written"
[ "$(stat -f %Lp "$DIR/config.json")" = "600" ]; check $? "config.json is mode 600"
grep -c collector.js "$HOMEDIR/.claude/settings.json" >/dev/null; check $? "SessionEnd hook installed"
[ -f "$HOMEDIR/Library/LaunchAgents/$LABEL.plist" ]; check $? "plist written into scratch HOME"
has "$OUT" "registered and verified with launchd" "installer reports a VERIFIED schedule"

hdr "T2  schedule shape: weekdays only, both times"
P="$HOMEDIR/Library/LaunchAgents/$LABEL.plist"
plutil -lint "$P" >/dev/null; check $? "plist is valid (plutil -lint)"
# Capture once rather than piping plutil into grep -q: under `set -o pipefail` a
# matching grep -q exits early, SIGPIPEs plutil, and the pipeline returns 141 --
# so a successful match would read as a failure.
PL=$(plutil -p "$P")
N=$(printf '%s' "$PL" | grep -c '"Weekday"')
[ "$N" = "10" ]; check $? "10 calendar entries (2 times x 5 weekdays), got $N"
case "$PL" in *'"Weekday" => 6'*) bad "no Saturday (Weekday 6)";; *) ok "no Saturday (Weekday 6)";; esac
case "$PL" in *'"Weekday" => 0'*) bad "no Sunday (Weekday 0)";; *) ok "no Sunday (Weekday 0)";; esac
case "$PL" in *'"Hour" => 13'*) ok "13:05 present";; *) bad "13:05 present";; esac
case "$PL" in *'"Hour" => 18'*) ok "18:05 present";; *) bad "18:05 present";; esac
case "$PL" in *'"Minute" => 5'*) ok "minute is :05, off the crowded top of the hour";; *) bad "minute is :05";; esac

hdr "T5/T6  weekend filter, and Friday must survive the weekend"
node "$SIM/fixture.js" "$HOMEDIR/.claude/projects" "$THU" "$FRI" "$SAT" "$SUN" "$NEXTMON" >/dev/null
DRY=$(run collector.js --dry-run --days 4 --skip-weekends | grep '"day"')
echo "$DRY" | sed 's/^/      | /'
hasnt "$DRY" "$SAT" "Saturday excluded"
hasnt "$DRY" "$SUN" "Sunday excluded"
has "$DRY" "$FRI" "Friday still sent after a weekend"
has "$DRY" "$NEXTMON" "Monday sent"

hdr "T6b  control: old behaviour really did drop Friday"
CTRL=$(run collector.js --dry-run --days 3 | grep '"day"')
echo "$CTRL" | sed 's/^/      | /'
hasnt "$CTRL" "$FRI" "without the fix Friday is dropped (bug was real)"

hdr "T3/T4  launchd fires it with NO Claude session and NO hook"
run setup.js --uninstall-hook >/dev/null
grep -c collector.js "$HOMEDIR/.claude/settings.json" >/dev/null 2>&1; no $? "hook removed - scheduler is the ONLY trigger"
rm -f "$SIM/received.json"
FIREH=$(date -v+90S +%H); FIREM=$(date -v+90S +%M)
run setup.js --schedule --at "$FIREH:$FIREM" >/dev/null
cp "$P" "$REAL_PLIST"
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$REAL_PLIST" 2>/dev/null || launchctl load "$REAL_PLIST"
echo "      waiting up to 150s for launchd to fire at $FIREH:$FIREM (no manual invocation)..."
for i in $(seq 1 30); do [ -f "$SIM/received.json" ] && break; sleep 5; done
[ -f "$SIM/received.json" ]; check $? "launchd fired the job unattended and data was POSTed"
if [ -f "$SIM/received.json" ]; then
  node -e "
    const r=require('$SIM/received.json');
    console.log('      days   :', r.map(x=>x.payload.day).join(', '));
    console.log('      auth   :', r[0].auth);
    console.log('      agent  :', JSON.stringify(r[0].payload.agent));"
  node -e "const r=require('$SIM/received.json');process.exit(r[0].auth==='Bearer clct_simtoken'?0:1)"; check $? "correct bearer token sent"
  node -e "const r=require('$SIM/received.json');process.exit(r.some(x=>['$SAT','$SUN'].includes(x.payload.day))?1:0)"; check $? "scheduled run sent no weekend day"
  node -e "const r=require('$SIM/received.json');process.exit(r[0].payload.agent.triggerTier==='scheduler'?0:1)"; check $? "agent health reports tier=scheduler"
fi

hdr "T7  blocked scheduler degrades honestly instead of lying"
SHIM="$SB/shim"; mkdir -p "$SHIM"
printf '#!/bin/sh\nexit 1\n' > "$SHIM/launchctl"; chmod +x "$SHIM/launchctl"
rm -f "$P"
OUT=$( cd "$DIR" && HOME="$HOMEDIR" PATH="$SHIM:$PATH" node setup.js --schedule 2>&1 ); RC=$?
echo "$OUT" | sed 's/^/      | /'
[ "$RC" = "0" ]; check $? "exits 0 so a locked-down machine still completes install"
LOW=$(printf '%s' "$OUT" | tr '[:upper:]' '[:lower:]')
if contains "$LOW" "falling back" || contains "$LOW" "could not" || contains "$LOW" "accepted no job"; then ok "reports the degradation"; else bad "reports the degradation"; fi
hasnt "$LOW" "registered and verified" "does NOT claim a verified schedule"

hdr "T7b  stale job from another install dir is not counted as healthy"
mkdir -p "$HOMEDIR/Library/LaunchAgents"
cat > "$P" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/usr/bin/node</string>
  <string>/Users/someone/Downloads/claude-usage-collector/collector.js</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>18</integer></dict>
</dict></plist>
PLIST
ST=$(run setup.js --status | tail -1); echo "      $ST"
[ "$ST" != "tier=scheduler" ]; check $? "plist pointing at another folder is not a live schedule"

hdr "T8  re-running the installer is idempotent"
run setup.js --token clct_simtoken --url "http://127.0.0.1:$PORT" --hook --schedule >/dev/null
run setup.js --token clct_simtoken --url "http://127.0.0.1:$PORT" --hook --schedule >/dev/null
H=$(node -e "const s=require('$HOMEDIR/.claude/settings.json');console.log(s.hooks.SessionEnd.length)")
[ "$H" = "1" ]; check $? "exactly one hook entry after two installs (got $H)"
NP=$(plutil -p "$P" | grep -c '"Weekday"'); [ "$NP" = "10" ]; check $? "plist still has 10 entries, not duplicated (got $NP)"

hdr "T1b/T11  the REAL shipped one-liner, and the token-less upgrade path"
# Run the exact INSTALL_SH text served by installController.ts, against a scratch
# HOME, so drift between "what we ship" and "what we tested" cannot happen.
node "$SIM/extract-installer.js" > "$SB/install.sh" 2>/dev/null; check $? "extracted INSTALL_SH from installController.ts"
UPHOME="$SB/uphome"; UPDIR="$UPHOME/claude-usage-collector"
mkdir -p "$UPHOME"
OUT=$(HOME="$UPHOME" bash "$SB/install.sh" --token clct_fresh --url "http://127.0.0.1:$PORT" --dir "$UPDIR" 2>&1); RC=$?
echo "$OUT" | sed 's/^/      | /'
[ "$RC" = "0" ]; check $? "shipped installer exits 0"
[ -f "$UPDIR/collector.js" ] && [ -f "$UPDIR/setup.js" ]; check $? "installer downloaded both files"
has "$OUT" "Reporting is driven by" "installer prints a VERIFIED status line"
has "$OUT" "daily OS job" "status line confirms a daily OS job is live"
# Now the upgrade path: same command, NO token, existing config must survive.
BEFORE=$(node -e "console.log(require('$UPDIR/config.json').ingestToken)")
OUT2=$(HOME="$UPHOME" bash "$SB/install.sh" --url "http://127.0.0.1:$PORT" --dir "$UPDIR" 2>&1); RC2=$?
[ "$RC2" = "0" ]; check $? "re-run without --token succeeds (the rollout command)"
AFTER=$(node -e "console.log(require('$UPDIR/config.json').ingestToken)")
[ "$BEFORE" = "$AFTER" ]; check $? "existing token preserved on token-less re-run"
has "$OUT2" "Keeping your existing config.json" "says it kept the existing config"
# And a first install with no token at all must refuse rather than half-install.
OUT3=$(HOME="$UPHOME" bash "$SB/install.sh" --url "http://127.0.0.1:$PORT" --dir "$SB/virgin" 2>&1); RC3=$?
[ "$RC3" != "0" ]; check $? "first install without --token is refused, not half-done"

hdr "T12  Windows task XML (structural only, no live Windows test)"
if node "$SIM/win-xml-check.js" "$DIR" >/tmp/winxml.$$ 2>&1; then
  sed 's/^/    /' /tmp/winxml.$$; pass=$((pass+9))
else
  sed 's/^/    /' /tmp/winxml.$$; fail=$((fail+1))
fi
rm -f /tmp/winxml.$$

hdr "RESULT"
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" = "0" ] || exit 1
