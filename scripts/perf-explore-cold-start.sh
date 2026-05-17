#!/usr/bin/env bash
# Cold-launch perf for the Explore tab → first BTC Map merchant visible.
#
# Usage:
#   scripts/perf-explore-cold-start.sh                  # 3 runs (default)
#   scripts/perf-explore-cold-start.sh 5                # 5 runs
#   PIGGY_DEVICE=emulator-5554 scripts/perf-explore-cold-start.sh
#   PIGGY_APP_ID=com.lightningpiggy.app.preview scripts/perf-explore-cold-start.sh
#   PERFETTO=1 scripts/perf-explore-cold-start.sh       # also capture a trace
#
# What it measures (per run):
#   - Wall-clock from `am start` → text "Bee Happy Farm" visible
#   - Frame jank via `dumpsys gfxinfo` (Janky %, p50/p95/p99 frame time)
#
# After all runs:
#   - Distribution: min, p50, p95, p99, max, mean (not just mean — outliers
#     are the user-visible problem, see #610).
#   - When PERFETTO=1: a .pftrace pulled to /tmp/, ready for perfetto.dev.
#
# Why "Bee Happy Farm": with a sensible AVD GPS fix near Longstanton
# (~52.296, 0.059) it's the closest cached BTC Map merchant, so the rail
# being populated implies "Places near you" rendered. Swap the asserted
# text if you re-pin the dev location. See `docs/PERFORMANCE.adoc` for
# the wider methodology.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/perf-stats.sh
source "$SCRIPT_DIR/lib/perf-stats.sh"

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

echo "Running $RUNS cold-launch samples on $DEVICE for $APP_ID…"
[ "${PERFETTO:-0}" = "1" ] && echo "(PERFETTO=1: a 40s trace will be captured on run 1)"
totals=()
for i in $(seq 1 "$RUNS"); do
  adb -s "$DEVICE" shell am force-stop "$APP_ID"
  sleep 2
  # Reset gfxinfo before each run so frame counters reflect only this launch.
  perf_gfxinfo_reset "$DEVICE" "$APP_ID"
  # Capture a Perfetto trace on the first run only — 40s covers the
  # measured cold-start with margin. Subsequent runs are wall-clock only.
  if [ "$i" = "1" ]; then
    perf_perfetto_start "$DEVICE" 40000 "$APP_ID"
  fi
  t1=$(date +%s%3N)
  adb -s "$DEVICE" shell am start -n "$APP_ID/.MainActivity" >/dev/null
  if maestro test "$TMP_FLOW" >/dev/null 2>&1; then
    t2=$(date +%s%3N)
    dt=$((t2 - t1))
    totals+=("$dt")
    printf '  run %d: %d ms — ' "$i" "$dt"
    perf_gfxinfo_sample "$DEVICE" "$APP_ID"
  else
    echo "  run $i: TIMEOUT (>60s — flow failed)"
  fi
  if [ "$i" = "1" ]; then
    perf_perfetto_stop "$DEVICE" "/tmp/explore-cold-start-trace-$(date +%H%M%S).pftrace"
  fi
done

if [ ${#totals[@]} -gt 0 ]; then
  perf_stats_report "Cold-start wall-clock" "${totals[@]}"
fi
