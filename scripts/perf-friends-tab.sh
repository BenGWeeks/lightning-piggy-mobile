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
# Parameterised so contributors on different emulators / release variants
# don't have to edit the script. Defaults match the dev-AVD setup.
PKG="${PKG:-com.lightningpiggy.app.dev}"
DEVICE="${DEVICE:-emulator-5554}"
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

echo "→ adb-screencap timeline (cumulative ms relative to tap return)"
# Filenames now match the cumulative sleep elapsed: 0.3 + 0.5 + 1.0 + 1.0
# = 0.3s, 0.8s, 1.8s, 2.8s. Older runs had t0500/t1000/t2000/t3000 which
# misled readers into thinking each capture was at a round half-second
# offset rather than at the cumulative wallclock.
sleep 0.3 && adb -s "$DEVICE" exec-out screencap -p > "$OUT/t0300.png"
sleep 0.5 && adb -s "$DEVICE" exec-out screencap -p > "$OUT/t0800.png"
sleep 1.0 && adb -s "$DEVICE" exec-out screencap -p > "$OUT/t1800.png"
sleep 1.0 && adb -s "$DEVICE" exec-out screencap -p > "$OUT/t2800.png"

echo "→ capturing post-tap gfxinfo"
adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" > "$OUT/gfxinfo-after.txt" 2>&1 || true

echo "→ summary"
{
  echo "label=$LABEL"
  grep -E "Total frames rendered|Janky frames|99th percentile|50th percentile|90th percentile|Number Slow frames|HISTOGRAM|gpu" "$OUT/gfxinfo-after.txt" | head -15
} | tee "$OUT/summary.txt"

echo "✓ done — $OUT"
