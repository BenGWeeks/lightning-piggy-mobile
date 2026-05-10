#!/usr/bin/env bash
#
# Measures wall-clock time from a cold app start to a 21-sat Lightning
# invoice rendering on screen. Captures the full path the user feels:
#   1. force-stop, launch
#   2. wait for Home tab to render
#   3. tap Receive
#   4. tap Enter custom amount
#   5. tap 2 1 (21 sats), confirm
#   6. wait for `lnbc...` invoice text under the QR
#
# Usage:
#   ./scripts/perf-cold-start-invoice.sh           # default 3 samples
#   SAMPLES=5 ./scripts/perf-cold-start-invoice.sh
#
set -u

DEVICE="${DEVICE:-emulator-5554}"
PKG="${PKG:-com.lightningpiggy.app.dev}"
SAMPLES="${SAMPLES:-3}"

OUT="/tmp/perf-cold-invoice-$(date +%s)"
mkdir -p "$OUT"
echo "→ writing to $OUT (samples: $SAMPLES, device: $DEVICE)"

cat > "$OUT/flow.yaml" <<EOF
appId: $PKG
---
- launchApp:
    appId: $PKG
    clearState: false
# Wait for the wallet card to actually render its balance — this is
# what the user perceives as "the app is ready for me to act". Until
# the card is up, btn-receive is disabled.
- extendedWaitUntil:
    visible:
      text: '.*sats.*'
    timeout: 45000
- tapOn:
    id: 'btn-receive'
# Big Piggy NWC has no per-wallet LN address, so ReceiveSheet skips
# its "main" step and lands straight on AmountEntryScreen — see
# ReceiveSheet.pickInitialView (#168/#169). For wallets that *do*
# expose a lud16, the flow would tap 'receive-enter-custom-amount'
# first; gate that hop on visibility instead of asserting it.
- runFlow:
    when:
      visible:
        id: 'receive-enter-custom-amount'
    commands:
      - tapOn:
          id: 'receive-enter-custom-amount'
- extendedWaitUntil:
    visible:
      id: 'amount-entry-input'
    timeout: 10000
- tapOn:
    id: 'amount-entry-key-2'
- tapOn:
    id: 'amount-entry-key-1'
- tapOn:
    id: 'amount-entry-confirm'
- extendedWaitUntil:
    visible:
      text: 'lnbc.*'
    timeout: 30000
EOF

results=()
for i in $(seq 1 "$SAMPLES"); do
  echo "--- sample $i / $SAMPLES ---"
  adb -s "$DEVICE" shell am force-stop "$PKG"
  sleep 2
  start=$(date +%s%3N)
  maestro test --device "$DEVICE" "$OUT/flow.yaml" > "$OUT/sample-$i.log" 2>&1
  rc=$?
  end=$(date +%s%3N)
  ms=$((end - start))
  if [ $rc -eq 0 ]; then
    echo "  ✔ ${ms}ms"
    results+=("$ms")
  else
    echo "  ✗ failed after ${ms}ms (rc=$rc)"
    tail -8 "$OUT/sample-$i.log" | sed 's/^/    /'
  fi
done

if [ ${#results[@]} -gt 0 ]; then
  printf '%s\n' "${results[@]}" | sort -n > "$OUT/sorted.txt"
  median=$(awk 'NR==int((NR+1)/2)' "$OUT/sorted.txt" 2>/dev/null || cat "$OUT/sorted.txt" | awk -v n="${#results[@]}" 'NR==int((n+1)/2)')
  median=$(sort -n "$OUT/sorted.txt" | awk -v n="${#results[@]}" 'NR==int((n+1)/2)')
  min=$(head -1 "$OUT/sorted.txt")
  max=$(tail -1 "$OUT/sorted.txt")
  cat <<S | tee "$OUT/summary.md"
## cold-start → 21-sat invoice rendered

| samples | min (ms) | median (ms) | max (ms) |
|---|---|---|---|
| ${#results[@]} | $min | $median | $max |

raw: ${results[*]}
S
fi
