#!/usr/bin/env bash
# SendSheet open latency on a WARM app — does NOT force-stop. Run after
# the user has been using the app for a few seconds so the NIP-17 inbox
# has drained and the JS thread is free.
set -u
DEVICE="${DEVICE:-${PIXEL_DEVICE:-37111FDJH0067B}}"
PKG="${PKG:-${PIXEL_PKG:-com.lightningpiggy.app}}"
SAMPLES="${SAMPLES:-5}"
OUT="/tmp/perf-send-warm-$(date +%s)"
mkdir -p "$OUT"
echo "→ writing to $OUT (samples: $SAMPLES, device: $DEVICE)"
if date +%s%3N 2>/dev/null | grep -q '^[0-9]\+$'; then now_ms() { date +%s%3N; }
else now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }; fi

cat > "$OUT/flow.yaml" <<YAML
appId: $PKG
---
- launchApp:
    appId: $PKG
    clearState: false
- extendedWaitUntil:
    visible: { id: 'btn-send' }
    timeout: 10000
- waitForAnimationToEnd: { timeout: 800 }
- tapOn: { id: 'btn-send' }
- extendedWaitUntil:
    visible: { text: 'Scan' }
    timeout: 8000
YAML

results=()
for i in $(seq 1 "$SAMPLES"); do
  echo "--- sample $i / $SAMPLES ---"
  # Make sure the sheet is closed (back press) and we're on Home before measuring.
  adb -s "$DEVICE" shell input keyevent KEYCODE_BACK
  sleep 1
  start=$(now_ms)
  maestro test --device "$DEVICE" "$OUT/flow.yaml" > "$OUT/sample-$i.log" 2>&1
  rc=$?
  end=$(now_ms)
  ms=$((end - start))
  if [ $rc -eq 0 ]; then
    echo "  ✔ ${ms}ms"
    results+=("$ms")
  else
    echo "  ✗ failed after ${ms}ms"
  fi
done
if [ ${#results[@]} -gt 0 ]; then
  printf '%s\n' "${results[@]}" | sort -n > "$OUT/sorted.txt"
  n=${#results[@]}
  median=$(awk -v n="$n" 'NR==int((n+1)/2)' "$OUT/sorted.txt")
  echo "median: ${median}ms (raw: ${results[*]})"
fi
