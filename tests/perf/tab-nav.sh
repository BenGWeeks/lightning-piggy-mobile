#!/usr/bin/env bash
# Warm tab-navigation perf: drives Home → Messages → Learn → Friends → Messages,
# timing each transition end-to-end (tap → content visible) and correlating
# logcat GC + [Perf] markers to each window.
#
# Prereq: app is running, user is logged in, at least one friend named $PEER
# is visible in Messages.
set +e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"

echo "=== WARM TAB NAV ($PKG on $DEVICE, peer=$PEER) ==="
PID=$(require_app_running)

LOG="$LOGDIR/tab-nav.log"
start_logcat "$PID" "$LOG"
trap stop_logcat EXIT

printf "\n%-22s  %-10s  %s\n" "STEP" "ELAPSED" "STATUS"
printf "%-22s  %-10s  %s\n"   "----"  "-------"  "------"

# Return the app to Home first so the walk starts from a known state.
# Maestro 2.3 treats `text:` as a full-regex match (not substring), so
# dynamic greetings like "Hello, <name>!" need a `.*` suffix.
cat > "$LOGDIR/_home.yaml" <<EOF
appId: $PKG
---
- tapOn:
    id: 'tab-home'
- extendedWaitUntil:
    visible:
      text: '${GREETING}.*'
    timeout: 10000
EOF
time_step "reset → home"         "$LOGDIR/_home.yaml"

# Each pair: tab-id : text-pattern (full-regex, so tab labels are exact
# matches and the Home greeting gets a `.*`).
for step in "messages:Messages" "learn:Learn" "friends:Friends" "messages:Messages" "home:${GREETING}.*"; do
  tab="${step%%:*}"
  text="${step##*:}"
  cat > "$LOGDIR/_t.yaml" <<EOF
appId: $PKG
---
- tapOn:
    id: 'tab-$tab'
- extendedWaitUntil:
    visible:
      text: '$text'
    timeout: 30000
EOF
  time_step "tab → $tab" "$LOGDIR/_t.yaml"
done

echo
echo "=== [Perf] markers during run ==="
grep "\[Perf\]" "$LOG" | tail -20
echo
echo "=== GC count during run ==="
grep -c "Background .* GC" "$LOG"
