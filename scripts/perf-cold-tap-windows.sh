#!/usr/bin/env bash
#
# Cold-start tap-latency across a range of "when did the user tap?"
# windows. A SINGLE-tap perf test misses freezes that start AFTER the
# tap fires — e.g. `resolveZapSenders` on cold start fires at +4-10 s
# and blocks the JS thread for ~7 s. A user who taps Send during that
# window experiences a long freeze; an automated test tapping at +1 s
# never sees it.
#
# This script does N cold-starts and taps at progressively later
# offsets from `[Perf] HomeScreen first render`. Latency is the wall-
# clock between tap and `btn-send onPress` log. Combined with the
# JS-thread heartbeat (`perfHeartbeatStart` in `src/utils/perfLog.ts`,
# logs gaps > 50 ms), this reveals WHERE in the cold-start timeline
# any freeze sits.
#
# Defaults to the Pixel; override via DEVICE / PKG.
#
set -u
DEVICE="${DEVICE:-${PIXEL_DEVICE:-37111FDJH0067B}}"
PKG="${PKG:-${PIXEL_PKG:-com.lightningpiggy.app}}"
TAP_X="${TAP_X:-772}"
TAP_Y="${TAP_Y:-1140}"
# Tap offset relative to [Perf] HomeScreen first render (ms).
WINDOWS_MS="${WINDOWS_MS:-0 500 1500 3000 5000 7000 10000 13000}"

now_ms() { date +%s%3N; }

echo "→ cold-start tap-window perf test"
echo "   device:    $DEVICE"
echo "   pkg:       $PKG"
echo "   tap:       ($TAP_X, $TAP_Y)"
echo "   windows:   $WINDOWS_MS  (ms after HomeScreen first render)"
echo

for delay in $WINDOWS_MS; do
  log="/tmp/perf-cold-tap-${delay}.log"
  adb -s "$DEVICE" shell am force-stop "$PKG"
  adb -s "$DEVICE" logcat -c
  (timeout 60 adb -s "$DEVICE" logcat -v threadtime ReactNativeJS:V > "$log" 2>&1 &)
  sleep 1
  adb -s "$DEVICE" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  # Poll for HomeScreen first render
  for try in $(seq 1 200); do
    if grep -q "HomeScreen first render" "$log" 2>/dev/null; then break; fi
    sleep 0.05
  done
  T_HOME=$(now_ms)
  # Wait `delay` ms past HomeScreen render before tapping
  while [ $(( $(now_ms) - T_HOME )) -lt "$delay" ]; do sleep 0.05; done
  T_TAP=$(now_ms)
  adb -s "$DEVICE" shell input tap "$TAP_X" "$TAP_Y"
  # Poll for btn-send onPress
  for try in $(seq 1 600); do
    if grep -q "btn-send onPress" "$log" 2>/dev/null; then break; fi
    sleep 0.05
  done
  T_OP=$(now_ms)
  sleep 1
  if grep -q "btn-send onPress" "$log"; then
    LAT=$(( T_OP - T_TAP ))
    # Largest JS-thread block found in heartbeat logs (gap=Xms)
    MAX_GAP=$(grep -oE 'gap=[0-9]+ms' "$log" | grep -oE '[0-9]+' | sort -rn | head -1)
    printf "  delay=%5sms  tap-to-onPress=%5sms  maxHeartbeatGap=%sms\n" \
      "$delay" "$LAT" "${MAX_GAP:-?}"
  else
    printf "  delay=%5sms  tap-to-onPress=FAILED (no onPress in 30s)\n" "$delay"
  fi
done
