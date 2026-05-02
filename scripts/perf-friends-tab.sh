#!/usr/bin/env bash
# Perf measurement harness for the Friends tab. Drives the navigation
# Home → Friends via Maestro, takes adb screencaps at fixed intervals,
# dumps gfxinfo jank stats, and writes everything to /tmp/perf-friends-<label>/.
#
# Usage:
#   ./scripts/perf-friends-tab.sh baseline
#   ./scripts/perf-friends-tab.sh candidate
#
# Output (in /tmp/perf-friends-$LABEL/):
#   gfxinfo-before.txt   snapshot before the tab tap
#   maestro.log          Maestro flow output
#   t0500.png … t3000.png    timeline of fill-in after the tap
#   gfxinfo-after.txt    snapshot after the tab is fully visible
#   summary.txt          one-line jank summary

set -u

LABEL="${1:-baseline}"
OUT="/tmp/perf-friends-${LABEL}"
PKG="com.lightningpiggy.app.dev"
DEVICE="emulator-5554"
FLOW="tests/e2e/perf-friends-tab-open.yaml"

mkdir -p "$OUT"
echo "→ writing to $OUT"

echo "→ resetting gfxinfo + capturing baseline"
adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" reset > /dev/null 2>&1 || true
adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" > "$OUT/gfxinfo-before.txt" 2>&1 || true

echo "→ running Maestro friends-tab flow"
maestro --device "$DEVICE" test "$FLOW" > "$OUT/maestro.log" 2>&1
MAESTRO_EXIT=$?
if [ "$MAESTRO_EXIT" -ne 0 ]; then
  echo "✗ Maestro flow failed (exit $MAESTRO_EXIT). See $OUT/maestro.log"
  exit 1
fi

echo "→ adb-screencap timeline (relative to tab tap return)"
sleep 0.3 && adb -s "$DEVICE" exec-out screencap -p > "$OUT/t0500.png"
sleep 0.5 && adb -s "$DEVICE" exec-out screencap -p > "$OUT/t1000.png"
sleep 1.0 && adb -s "$DEVICE" exec-out screencap -p > "$OUT/t2000.png"
sleep 1.0 && adb -s "$DEVICE" exec-out screencap -p > "$OUT/t3000.png"

echo "→ capturing post-tap gfxinfo"
adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" > "$OUT/gfxinfo-after.txt" 2>&1 || true

echo "→ summary"
{
  echo "label=$LABEL"
  grep -E "Total frames rendered|Janky frames|99th percentile|50th percentile|90th percentile|Number Slow frames|HISTOGRAM|gpu" "$OUT/gfxinfo-after.txt" | head -15
} | tee "$OUT/summary.txt"

echo "✓ done — $OUT"
