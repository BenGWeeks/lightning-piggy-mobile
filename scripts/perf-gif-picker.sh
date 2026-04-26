#!/usr/bin/env bash
# Perf measurement harness for the GIF picker. Opens the picker via
# Maestro, takes adb screencaps at fixed intervals, dumps gfxinfo
# jank stats, and writes everything to /tmp/perf-gif-<label>/.
#
# Run twice — once on baseline, once on candidate — then compare:
#   git checkout main
#   ./scripts/perf-gif-picker.sh baseline
#   git checkout feat/gif-picker-dynamic-animation
#   ./scripts/perf-gif-picker.sh candidate
#   diff -q /tmp/perf-gif-baseline /tmp/perf-gif-candidate
#
# Honest caveats:
# - AVD network is loopback fast, so wall-clock time-to-rendered is
#   compressed vs. a real device. The interesting deltas here are
#   *relative*: bytes downloaded, jank frames, CPU.
# - Maestro can't sleep, so timing accuracy comes from this bash
#   wrapper sleeping between adb screencaps.
#
# Output (in /tmp/perf-gif-$LABEL/):
#   gfxinfo-before.txt    snapshot of the dev app's render stats
#   t0500.png  t1000.png  t2000.png  t3000.png   (delays after picker open)
#   gfxinfo-after.txt     snapshot after the picker has been open ~3 s
#   netstats.txt          adb shell ip -s link diff (bytes per interface)
#   summary.txt           one-line summary (jank% delta, time-to-content)

set -u

LABEL="${1:-baseline}"
OUT="/tmp/perf-gif-${LABEL}"
PKG="com.lightningpiggy.app.dev"
DEVICE="emulator-5554"
FLOW="tests/e2e/perf-gif-picker-open.yaml"

mkdir -p "$OUT"
echo "→ writing to $OUT"

echo "→ resetting gfxinfo + capturing baseline"
adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" reset > /dev/null 2>&1 || true
adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" > "$OUT/gfxinfo-before.txt" 2>&1 || true
adb -s "$DEVICE" shell ip -s link > "$OUT/net-before.txt" 2>&1 || true

echo "→ running Maestro picker-open flow"
maestro --device "$DEVICE" test "$FLOW" > "$OUT/maestro.log" 2>&1
MAESTRO_EXIT=$?
if [ "$MAESTRO_EXIT" -ne 0 ]; then
  echo "✗ Maestro flow failed (exit $MAESTRO_EXIT). See $OUT/maestro.log"
  exit 1
fi

echo "→ adb-screencap timeline (relative to picker open)"
# Maestro returns ~200 ms after the GIF tile tap. Treat that as t=0.
sleep 0.3 && adb -s "$DEVICE" exec-out screencap -p > "$OUT/t0500.png"
sleep 0.5 && adb -s "$DEVICE" exec-out screencap -p > "$OUT/t1000.png"
sleep 1.0 && adb -s "$DEVICE" exec-out screencap -p > "$OUT/t2000.png"
sleep 1.0 && adb -s "$DEVICE" exec-out screencap -p > "$OUT/t3000.png"

echo "→ capturing post-picker gfxinfo + netstats"
adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" > "$OUT/gfxinfo-after.txt" 2>&1 || true
adb -s "$DEVICE" shell ip -s link > "$OUT/net-after.txt" 2>&1 || true

echo "→ summary"
JANK_LINE=$(grep -E "Janky frames|Number Slow frames" "$OUT/gfxinfo-after.txt" | head -2 | tr '\n' ' ')
echo "label=$LABEL jank=$JANK_LINE" | tee "$OUT/summary.txt"

echo "✓ done — $OUT"
