#!/usr/bin/env bash
# Steady-state scroll perf harness. Two-phase:
#   1. Maestro warmup flow (launch + tab tap + settle)
#   2. Reset gfxinfo
#   3. Maestro swipes flow (~12 fling gestures)
#   4. Capture gfxinfo
#
# This excludes the cold Skia / RenderThread init that dominates AVD
# cold-tab measurements, so the histogram captures ONLY the steady-state
# scroll work — exactly what the contactInfoMap stabilisation,
# recyclingKey, and drawDistance fixes target.
#
# Usage:
#   ./scripts/perf-scroll.sh friends <label>
#   ./scripts/perf-scroll.sh messages <label>

set -u

TAB="${1:-friends}"
LABEL="${2:-baseline}"
OUT="/tmp/perf-scroll-${TAB}-${LABEL}"
PKG="com.lightningpiggy.app.dev"
DEVICE="emulator-5554"
WARMUP_FLOW="tests/e2e/perf-${TAB}-scroll.yaml"
SWIPE_FLOW="tests/e2e/perf-${TAB}-swipes.yaml"

mkdir -p "$OUT"
echo "→ writing to $OUT"

echo "→ Maestro warmup (launch + tab tap)"
maestro --device "$DEVICE" test "$WARMUP_FLOW" > "$OUT/maestro-warmup.log" 2>&1
WARMUP_EXIT=$?
if [ "$WARMUP_EXIT" -ne 0 ]; then
  echo "✗ Warmup flow failed (exit $WARMUP_EXIT). See $OUT/maestro-warmup.log"
  exit 1
fi

echo "→ resetting gfxinfo (cold mount settled, swipes about to start)"
adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" reset > /dev/null 2>&1 || true

echo "→ Maestro swipes (10 fling gestures)"
maestro --device "$DEVICE" test "$SWIPE_FLOW" > "$OUT/maestro-swipes.log" 2>&1
SWIPE_EXIT=$?
if [ "$SWIPE_EXIT" -ne 0 ]; then
  echo "✗ Swipe flow failed (exit $SWIPE_EXIT). See $OUT/maestro-swipes.log"
  exit 1
fi

echo "→ capturing post-scroll gfxinfo"
adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" > "$OUT/gfxinfo-after.txt" 2>&1 || true

echo "→ summary"
{
  echo "label=$LABEL tab=$TAB"
  grep -E "Total frames rendered|Janky frames|99th percentile|99th gpu|Number Slow frames" "$OUT/gfxinfo-after.txt" | head -12
} | tee "$OUT/summary.txt"

echo "✓ done — $OUT"
