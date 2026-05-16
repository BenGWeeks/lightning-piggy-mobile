#!/usr/bin/env bash
# Cold-launch perf for the Explore tab → first BTC Map merchant visible.
#
# Usage:
#   scripts/perf-explore-cold-start.sh                 # 3 runs (default)
#   scripts/perf-explore-cold-start.sh 5               # 5 runs
#   PIGGY_DEVICE=emulator-5554 scripts/perf-explore-cold-start.sh
#
# What it measures:
#   force-stop → am start → tap Explore tab → text "Bee Happy Farm" visible
#
# Why "Bee Happy Farm": the GPS dev-fallback (EXPO_PUBLIC_DEV_LAT/LON in .env,
# Longstanton 52.28/0.04) puts it as the closest cached BTC Map merchant, so
# we wait on it as the canary for "Places near you" being populated. Swap
# the asserted text below if you re-pin the dev location.

set -euo pipefail
RUNS=${1:-3}
DEVICE=${PIGGY_DEVICE:-emulator-5554}
APP_ID=${PIGGY_APP_ID:-com.lightningpiggy.app.dev}

TMP_FLOW=$(mktemp --suffix=.yaml)
cat > "$TMP_FLOW" <<YAML
appId: $APP_ID
---
- launchApp:
    stopApp: false
- tapOn:
    id: "tab-explore"
- extendedWaitUntil:
    visible:
      text: "Bee Happy Farm"
    timeout: 60000
YAML

echo "Running $RUNS cold-launch samples on $DEVICE…"
totals=()
for i in $(seq 1 "$RUNS"); do
  adb -s "$DEVICE" shell am force-stop "$APP_ID"
  sleep 2
  t1=$(date +%s%3N)
  adb -s "$DEVICE" shell am start -n "$APP_ID/.MainActivity" >/dev/null
  if maestro test "$TMP_FLOW" >/dev/null 2>&1; then
    t2=$(date +%s%3N)
    dt=$((t2 - t1))
    totals+=("$dt")
    echo "  run $i: ${dt} ms"
  else
    echo "  run $i: TIMEOUT (>60 s — flow failed)"
  fi
done

if [ ${#totals[@]} -gt 0 ]; then
  sum=0
  for t in "${totals[@]}"; do sum=$((sum + t)); done
  echo
  echo "Mean: $((sum / ${#totals[@]})) ms across ${#totals[@]} successful run(s)"
fi
