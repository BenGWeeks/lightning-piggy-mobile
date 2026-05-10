#!/usr/bin/env bash
#
# Wall-clock latency from tapping btn-send on Home to the SendSheet
# being interactive (the Scan / Input tab row visible). Captures
# adb logcat for the same window so the slow phase is attributable.
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
  # Background logcat for the duration of this sample.
  adb -s "$DEVICE" logcat -c
  adb -s "$DEVICE" logcat -v time *:I > "$OUT/sample-$i.logcat" 2>&1 &
  LOGCAT_PID=$!
  start=$(now_ms)
  maestro test --device "$DEVICE" "$OUT/flow.yaml" > "$OUT/sample-$i.maestro.log" 2>&1
  rc=$?
  end=$(now_ms)
  kill $LOGCAT_PID 2>/dev/null
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
