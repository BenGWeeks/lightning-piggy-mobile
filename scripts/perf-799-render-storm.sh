#!/usr/bin/env bash
# Measures the ExploreHomeScreen render-storm fix from PR #799.
#
# Usage:
#   PIGGY_DEVICE=37111FDJH0067B bash scripts/perf-799-render-storm.sh [LABEL]
#
# LABEL is printed in the output so AFTER and BEFORE runs can be told apart.
# The script:
#   1. Force-stops the dev app.
#   2. Clears logcat + resets gfxinfo.
#   3. Keeps screen on, launches the app, waits 3s (Home loads), taps Explore.
#   4. Lets Explore run for 35s (the measurement window from the earlier audit).
#   5. Parses:
#        - [PerfBlock] render:ExploreHomeScreen lines → count + p50/p95/p99/max (ms)
#        - fetchCachesByAuthor service log lines → # relay queries fired
#   6. Samples gfxinfo (janky %, p50/p95/p99 frame time).
#
# Requires: bash 4+, adb on PATH, maestro on PATH (for tab tap), screen unlocked.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/perf-stats.sh
source "$SCRIPT_DIR/lib/perf-stats.sh"

DEVICE="${PIGGY_DEVICE:-37111FDJH0067B}"
APP_ID="${PIGGY_APP_ID:-com.lightningpiggy.app.dev}"
LABEL="${1:-UNLABELLED}"
WINDOW_SECS=35

echo ""
echo "=== perf-799-render-storm  label=$LABEL  device=$DEVICE ==="
echo ""

# 0. Ensure screen stays on for the whole measurement.
echo "Setting screen stay-awake (USB)…"
adb -s "$DEVICE" shell svc power stayon usb 2>/dev/null || true

# Check screen is actually on and unlocked.
FOCUS=$(adb -s "$DEVICE" shell "dumpsys window | grep mCurrentFocus" 2>/dev/null || true)
echo "  Current focus: $FOCUS"
if echo "$FOCUS" | grep -qi "bouncer\|keyguard\|lock"; then
  echo ""
  echo "ERROR: Device screen is locked (keyguard/bouncer). Unlock the phone first."
  echo "       Run: adb -s $DEVICE shell wm dismiss-keyguard  (or unlock with fingerprint/PIN)"
  exit 1
fi

# 1. Force-stop so the next launch is a cold start.
echo "Force-stopping $APP_ID…"
adb -s "$DEVICE" shell am force-stop "$APP_ID"
sleep 2

# 2. Clear logcat buffer so we only see output from this run.
echo "Clearing logcat buffer…"
adb -s "$DEVICE" logcat -c
sleep 1

# 3. Reset gfxinfo frame counters.
perf_gfxinfo_reset "$DEVICE" "$APP_ID"

# 4. Start logcat capture in background BEFORE launching the app.
LOG_FILE=$(mktemp --suffix=.log)
adb -s "$DEVICE" logcat -v time 2>/dev/null > "$LOG_FILE" &
LOGCAT_PID=$!
echo "Logcat capture started (pid=$LOGCAT_PID, file=$LOG_FILE)"

# 5. Cold-launch the app.
echo "Cold-launching app ($APP_ID/.MainActivity)…"
adb -s "$DEVICE" shell am start -n "$APP_ID/.MainActivity" > /dev/null
sleep 4   # Give Home tab time to render before we tap Explore.

# 6. Tap the Explore tab using Maestro (testID-based, not coordinates).
echo "Tapping Explore tab via Maestro…"
TMP_FLOW=$(mktemp --suffix=.yaml)
cat > "$TMP_FLOW" <<YAML
appId: $APP_ID
---
- launchApp:
    stopApp: false
- tapOn:
    id: "tab-explore"
YAML
if maestro --device "$DEVICE" test "$TMP_FLOW" > /tmp/maestro-tap.log 2>&1; then
  echo "  Maestro tap: OK"
else
  echo "  Maestro tap: FAILED — see /tmp/maestro-tap.log"
  cat /tmp/maestro-tap.log | tail -10
fi
rm -f "$TMP_FLOW"

# Verify Explore is in the foreground.
sleep 1
FOCUS2=$(adb -s "$DEVICE" shell "dumpsys window | grep mCurrentFocus" 2>/dev/null || true)
echo "  Focus after tap: $FOCUS2"

T_START=$(date +%s%3N)
echo "Measuring for ${WINDOW_SECS}s (screen must stay on)…"
sleep "$WINDOW_SECS"

T_END=$(date +%s%3N)
ELAPSED=$(( T_END - T_START ))

# Stop logcat.
kill "$LOGCAT_PID" 2>/dev/null || true
wait "$LOGCAT_PID" 2>/dev/null || true
echo "Capture done (${ELAPSED}ms wall-clock). Log: $LOG_FILE ($(wc -l < "$LOG_FILE") lines)"

# 7. Sample gfxinfo now (after the 35s window).
echo -n "  "
perf_gfxinfo_sample "$DEVICE" "$APP_ID"

# 8. Parse the logcat output for render durations.
echo ""
echo "--- Render analysis ---"

# [PerfBlock] render:ExploreHomeScreen <phase>=<N>ms
# The React.Profiler callback (>100ms threshold) emits exactly this.
mapfile -t RENDER_LINES < <(grep -o '\[PerfBlock\] render:ExploreHomeScreen [a-z]*=[0-9]*ms' "$LOG_FILE" 2>/dev/null || true)
RENDER_COUNT=${#RENDER_LINES[@]}

if (( RENDER_COUNT > 0 )); then
  mapfile -t DURATIONS < <(printf '%s\n' "${RENDER_LINES[@]}" | grep -o '[0-9]*ms' | grep -o '[0-9]*')
  perf_stats_report "ExploreHomeScreen render durations (>100ms each)" "${DURATIONS[@]}"
  echo "  renders logged (>100ms): $RENDER_COUNT"
  TOTAL_BLOCK=0
  for d in "${DURATIONS[@]}"; do
    TOTAL_BLOCK=$(( TOTAL_BLOCK + d ))
  done
  echo "  total blocking render time: ${TOTAL_BLOCK}ms"
else
  echo "  ExploreHomeScreen renders >100ms: 0"
  echo "  Expected AFTER outcome: renders are cheap, none exceed the 100ms Profiler threshold."
fi

# 9. Count fetchCachesByAuthor relay queries.
echo ""
echo "--- fetchCachesByAuthor relay queries ---"
BY_AUTHOR_SVC=$(grep -c 'ReactNativeJS.*\[PerfBlock\] fetchCachesByAuthor:' "$LOG_FILE" 2>/dev/null || echo "0")
BY_AUTHOR_MERGES=$(grep -c '\[PerfBlock\] ExploreHome by-author merge: fetched=' "$LOG_FILE" 2>/dev/null || echo "0")
echo "  Service-level completions: $BY_AUTHOR_SVC"
echo "  ExploreHome merge callbacks: $BY_AUTHOR_MERGES"
echo ""
echo "  Raw lines:"
grep 'ReactNativeJS.*fetchCachesByAuthor\|\[PerfBlock\] ExploreHome by-author' "$LOG_FILE" 2>/dev/null \
  | grep -o '\[PerfBlock\].*' \
  | head -20 \
  || echo "  (none)"

# 10. Show all PerfBlock lines for transparency.
echo ""
echo "--- All PerfBlock lines in window ---"
grep '\[PerfBlock\]' "$LOG_FILE" 2>/dev/null || echo "  (none)"

rm -f "$LOG_FILE"
echo ""
echo "=== done: $LABEL ==="
