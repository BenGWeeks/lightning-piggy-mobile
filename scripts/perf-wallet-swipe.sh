#!/usr/bin/env bash
#
# Swipe latency on Home's wallet carousel (#1304): time from a card settling
# to Home committing THAT wallet's transaction list (0 ms = it was already on
# screen when the card settled).
#
# Swipes back and forth between the first two wallet cards SWIPES times
# (Maestro, testID selectors only), then reads the `[Perf] WalletSwipe
# switch→list` / `settled→list` markers (src/utils/walletSwipeTiming.ts) and
# prints p50 / p95 / max for each. `switch→list` is the main metric.
#
# Needs a dev build (or EXPO_PUBLIC_KEEP_PERF_LOGS=1), the app open on Home,
# and an account with 2+ wallets.
#
# Usage:
#   ./scripts/perf-wallet-swipe.sh                        # Android, logcat, 10 swipes
#   SWIPES=20 DEVICE=127.0.0.1:5565 ./scripts/perf-wallet-swipe.sh
#   LOG=/tmp/metro.log ./scripts/perf-wallet-swipe.sh      # read markers from a Metro log (iOS)
#   STATS_ONLY=1 LOG=/tmp/metro.log ./scripts/perf-wallet-swipe.sh
set -u

DEVICE="${DEVICE:-emulator-5554}"
PKG="${PKG:-com.lightningpiggy.app.dev}"
SWIPES="${SWIPES:-10}"
LOG="${LOG:-}"
OUT="/tmp/perf-wallet-swipe-$(date +%s)"
mkdir -p "$OUT"

if [ "${STATS_ONLY:-0}" != "1" ]; then
  # Left to card 2, right back to card 1, repeated. `wallet-card-*` matches
  # the card that's in view; the swipe starts on it.
  {
    echo "appId: $PKG"
    echo "---"
    for _ in $(seq 1 $(((SWIPES + 1) / 2))); do
      for dir in LEFT RIGHT; do
        echo "- swipe:"
        echo "    from:"
        echo "      id: 'wallet-card-.*'"
        echo "    direction: $dir"
        echo "    duration: 200"
        echo "- waitForAnimationToEnd:"
        echo "    timeout: 3000"
      done
    done
  } > "$OUT/flow.yaml"

  [ -z "$LOG" ] && adb -s "$DEVICE" logcat -c
  maestro --device "$DEVICE" test "$OUT/flow.yaml" > "$OUT/maestro.log" 2>&1 \
    || { echo "maestro failed — see $OUT/maestro.log"; exit 1; }
  sleep 2
fi

if [ -n "$LOG" ]; then
  cp "$LOG" "$OUT/markers.log"
else
  adb -s "$DEVICE" logcat -d -s ReactNativeJS:V > "$OUT/markers.log"
fi

for metric in 'switch→list' 'settled→list'; do
  grep -o "WalletSwipe $metric [0-9a-f-]* [0-9]*ms" "$OUT/markers.log" \
    | awk '{gsub("ms","",$4); print $4}' > "$OUT/samples.txt"
  python3 - "$OUT/samples.txt" "$metric" <<'PY'
import sys
xs = sorted(int(l) for l in open(sys.argv[1]) if l.strip())
if not xs:
    sys.exit(f"no {sys.argv[2]} markers found")
def pct(p):
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]
print(f"{sys.argv[2]}: swipes={len(xs)} p50={pct(50)}ms p95={pct(95)}ms max={xs[-1]}ms samples={xs}")
PY
done
echo "→ $OUT"
