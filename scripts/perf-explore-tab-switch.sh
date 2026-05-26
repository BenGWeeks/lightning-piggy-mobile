#!/usr/bin/env bash
# Warm tab-switch perf for the Explore tab (Home → Explore → Home loop).
#
# Targets the user-reported "navigating back and forth between Home and
# Explore feels laggy even on a fresh identity" symptom — distinct from
# the cold-start case (`perf-explore-cold-start.sh`). On a warm app the
# JS bundle is parsed, the wallet is hydrated, and the navigator state
# is settled — the only work done on each Explore focus is the
# `useFocusEffect` body (open relay subs, refire derived memos,
# re-render the MapLibre marker layout via LibreMiniMap's memo).
#
# Usage:
#   scripts/perf-explore-tab-switch.sh                  # 5 switches (default)
#   scripts/perf-explore-tab-switch.sh 10               # 10 switches
#   PIGGY_DEVICE=emulator-5554 ...
#   PIGGY_APP_ID=com.lightningpiggy.app.preview ...
#   PERFETTO=1 ...                                      # trace on switch 1
#
# What it measures (per switch):
#   - Wall-clock from tap on Explore tab → "Bee Happy Farm" visible
#   - Frame jank via `dumpsys gfxinfo` (Janky %, p50/p95/p99 frame time)
#
# Each switch is preceded by a tap-back-to-Home so the next iteration
# starts from a clean focus boundary. The very first Explore focus is
# treated as a warm-up (not measured) — it pays the BTC Map prefetch +
# first relay handshake cost, neither of which recurs on subsequent
# focus events.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/perf-stats.sh
source "$SCRIPT_DIR/lib/perf-stats.sh"

RUNS=${1:-5}
DEVICE=${PIGGY_DEVICE:-emulator-5554}
APP_ID=${PIGGY_APP_ID:-com.lightningpiggy.app.dev}

# Warm-up flow: launch + first Explore tap + first Home tap. Not timed.
WARMUP_FLOW=$(mktemp --suffix=.yaml)
cat > "$WARMUP_FLOW" <<YAML
appId: $APP_ID
---
- launchApp:
    stopApp: false
- extendedWaitUntil:
    visible:
      id: "tab-home"
    timeout: 30000
- tapOn:
    id: "tab-explore"
- extendedWaitUntil:
    visible:
      text: "Bee Happy Farm"
    timeout: 60000
- tapOn:
    id: "tab-home"
- extendedWaitUntil:
    visible:
      id: "tab-home"
    timeout: 5000
YAML

# Measured iteration: tap Explore, wait for content, tap Home. We time
# the *first* tap-to-content portion; the trailing Home tap resets the
# focus state for the next iteration but isn't timed.
SWITCH_FLOW=$(mktemp --suffix=.yaml)
cat > "$SWITCH_FLOW" <<YAML
appId: $APP_ID
---
- tapOn:
    id: "tab-explore"
- extendedWaitUntil:
    visible:
      text: "Bee Happy Farm"
    timeout: 60000
YAML

RESET_FLOW=$(mktemp --suffix=.yaml)
cat > "$RESET_FLOW" <<YAML
appId: $APP_ID
---
- tapOn:
    id: "tab-home"
- extendedWaitUntil:
    visible:
      id: "tab-home"
    timeout: 5000
YAML

echo "Warming up: launch + first Explore focus + back to Home…"
adb -s "$DEVICE" shell am force-stop "$APP_ID"
sleep 2
adb -s "$DEVICE" shell am start -n "$APP_ID/.MainActivity" >/dev/null
if ! maestro test "$WARMUP_FLOW" >/dev/null 2>&1; then
  echo "Warm-up flow failed — aborting. (Are you signed in? Is location set?)"
  exit 2
fi

echo "Running $RUNS warm tab-switch samples on $DEVICE for $APP_ID…"
[ "${PERFETTO:-0}" = "1" ] && echo "(PERFETTO=1: a 65s trace will be captured on switch 1)"
totals=()
for i in $(seq 1 "$RUNS"); do
  perf_gfxinfo_reset "$DEVICE" "$APP_ID"
  if [ "$i" = "1" ]; then
    perf_perfetto_start "$DEVICE" 65000 "$APP_ID"
  fi
  t1=$(date +%s%3N)
  if maestro test "$SWITCH_FLOW" >/dev/null 2>&1; then
    t2=$(date +%s%3N)
    dt=$((t2 - t1))
    totals+=("$dt")
    printf '  switch %d: %d ms — ' "$i" "$dt"
    perf_gfxinfo_sample "$DEVICE" "$APP_ID"
  else
    echo "  switch $i: TIMEOUT (>60s — flow failed)"
  fi
  if [ "$i" = "1" ]; then
    perf_perfetto_stop "$DEVICE" "/tmp/explore-tab-switch-trace-$(date +%H%M%S).pftrace"
  fi
  # Reset for next iteration — tap Home so we re-enter Explore from
  # the same focus boundary every time.
  maestro test "$RESET_FLOW" >/dev/null 2>&1 || true
done

if [ ${#totals[@]} -gt 0 ]; then
  perf_stats_report "Tab-switch (Home → Explore) wall-clock" "${totals[@]}"
fi
