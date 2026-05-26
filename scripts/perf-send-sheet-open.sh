#!/usr/bin/env bash
#
# Wall-clock latency from `am force-stop` to the SendSheet being
# interactive (the Scan / Input tab row visible). The timer brackets
# the entire Maestro flow including launch + cold-start + the eventual
# btn-send tap, NOT just the tap-to-render slice — so don't read the
# raw number as "Send sheet animation duration". The useful comparison
# is the same script, same device, same fixture, before vs after a
# perf change.
#
# Captures adb logcat for the same window so the slow phase is
# attributable in the per-sample log file.
#
# Defaults to the Pixel; override via DEVICE / PKG.
#
set -u

DEVICE="${DEVICE:-${PIXEL_DEVICE:-37111FDJH0067B}}"
PKG="${PKG:-${PIXEL_PKG:-com.lightningpiggy.app}}"
SAMPLES="${SAMPLES:-3}"

OUT="/tmp/perf-send-sheet-$(date +%s)"
mkdir -p "$OUT"
echo "→ writing to $OUT (samples: $SAMPLES, device: $DEVICE, pkg: $PKG)"

if date +%s%3N 2>/dev/null | grep -q '^[0-9]\+$'; then
  now_ms() { date +%s%3N; }
else
  now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
fi

cat > "$OUT/flow.yaml" <<EOF
appId: $PKG
---
- launchApp:
    appId: $PKG
    clearState: false
- extendedWaitUntil:
    visible:
      id: 'btn-send'
    timeout: 30000
- waitForAnimationToEnd:
    timeout: 1500
- tapOn:
    id: 'btn-send'
- extendedWaitUntil:
    visible:
      text: 'Scan'
    timeout: 15000
EOF

results=()
for i in $(seq 1 "$SAMPLES"); do
  echo "--- sample $i / $SAMPLES ---"
  adb -s "$DEVICE" shell am force-stop "$PKG"
  sleep 2
  # Background logcat for the duration of this sample. Trap ensures
  # the background tail is killed if the script is interrupted (Ctrl-C,
  # SIGTERM, exit). Without the trap an aborted run leaves stray
  # `adb logcat` processes that conflict with later runs.
  adb -s "$DEVICE" logcat -c
  adb -s "$DEVICE" logcat -v time *:I > "$OUT/sample-$i.logcat" 2>&1 &
  LOGCAT_PID=$!
  trap 'kill $LOGCAT_PID 2>/dev/null' EXIT INT TERM
  start=$(now_ms)
  maestro test --device "$DEVICE" "$OUT/flow.yaml" > "$OUT/sample-$i.maestro.log" 2>&1
  rc=$?
  end=$(now_ms)
  kill $LOGCAT_PID 2>/dev/null
  trap - EXIT INT TERM
  ms=$((end - start))
  if [ $rc -eq 0 ]; then
    echo "  ✔ ${ms}ms"
    results+=("$ms")
  else
    echo "  ✗ failed after ${ms}ms (rc=$rc)"
    tail -8 "$OUT/sample-$i.maestro.log" | sed 's/^/    /'
  fi
done

if [ ${#results[@]} -gt 0 ]; then
  printf '%s\n' "${results[@]}" | sort -n > "$OUT/sorted.txt"
  n=${#results[@]}
  median=$(awk -v n="$n" 'NR==int((n+1)/2)' "$OUT/sorted.txt")
  min=$(head -1 "$OUT/sorted.txt")
  max=$(tail -1 "$OUT/sorted.txt")
  cat <<S | tee "$OUT/summary.md"
## Home → SendSheet open latency (cold)

| device | pkg | samples | min (ms) | median (ms) | max (ms) |
|---|---|---:|---:|---:|---:|
| $DEVICE | $PKG | ${#results[@]} | $min | $median | $max |

raw: ${results[*]}
S
fi
