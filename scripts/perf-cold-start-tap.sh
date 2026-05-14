#!/usr/bin/env bash
# Cold-launch "time to interactive" for the tab bar.
#
# Measures the gap between `am start` and the moment a bottom-tab tap
# actually lands + the target screen renders. That gap is what the user
# experiences as "the app won't let me tap a tab yet" — the symptom of
# issue #526 (a ~6 s JS-thread freeze from synchronous secp256k1
# verification while the zap-sender resolver runs on cold start).
#
# Usage:
#   scripts/perf-cold-start-tap.sh                 # 3 runs (default)
#   scripts/perf-cold-start-tap.sh 5               # 5 runs
#   PIGGY_DEVICE=emulator-5554 scripts/perf-cold-start-tap.sh
#
# What it does each run:
#   1. Clears the zap-sender profile cache + the resolver fingerprint —
#      the freeze is *cold-cache only*, so without this a second run
#      would measure the warm (fast) path and hide the regression.
#   2. force-stop, then `am start`, capturing t0.
#   3. A Maestro flow taps the Learn tab and waits for `learn-search-
#      toggle` to be visible — i.e. the tap was processed AND the screen
#      rendered. Captures t1.
#   4. Reports t1 - t0.
#
# Note: this is a manual / CI perf probe, not a flaky pass/fail gate —
# Maestro timing on an emulator is noisy. Run it before/after a change
# and compare the mean.

set -euo pipefail
RUNS=${1:-3}
DEVICE=${PIGGY_DEVICE:-emulator-5554}
APP_ID=${PIGGY_APP_ID:-com.lightningpiggy.app.dev}
DB_PATH="/data/data/${APP_ID}/databases/RKStorage"

# `date +%s%3N` requires GNU date (Linux); macOS BSD date doesn't expand
# `%N`. Detect once and fall back to python3 — mirrors scripts/perf-startup.sh.
if date +%N 2>/dev/null | grep -qE '^[0-9]{9}$'; then
  now_ms() { date +%s%3N; }
else
  now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
fi

# Portable mktemp: BSD/macOS needs a positional template or `-t`; the
# `-t` form works on both. Clean it up on exit.
TMP_FLOW=$(mktemp -t perfcoldtap.XXXXXX)
trap 'rm -f "$TMP_FLOW"' EXIT
cat > "$TMP_FLOW" <<YAML
appId: $APP_ID
---
- launchApp:
    appId: $APP_ID
    stopApp: false
- tapOn:
    id: "tab-learn"
- extendedWaitUntil:
    visible:
      id: "learn-search-toggle"
    timeout: 60000
YAML

# Clear the caches that make the freeze reproducible. `|| true` — the
# key may simply not exist yet on a clean install.
clear_caches() {
  adb -s "$DEVICE" shell run-as "$APP_ID" sh -c \
    "sqlite3 $DB_PATH \"DELETE FROM catalystLocalStorage WHERE key IN ('zap_sender_profiles_v1','zap_resolver_fingerprints_v1');\"" \
    >/dev/null 2>&1 || true
}

echo "Running $RUNS cold-launch → tab-tappable samples on $DEVICE…"
totals=()
for i in $(seq 1 "$RUNS"); do
  clear_caches
  adb -s "$DEVICE" shell am force-stop "$APP_ID"
  sleep 2
  t1=$(now_ms)
  adb -s "$DEVICE" shell am start -n "$APP_ID/.MainActivity" >/dev/null
  if maestro --device "$DEVICE" test "$TMP_FLOW" >/dev/null 2>&1; then
    t2=$(now_ms)
    dt=$((t2 - t1))
    totals+=("$dt")
    echo "  run $i: ${dt} ms"
  else
    echo "  run $i: TIMEOUT (>60 s — tab never became interactive)"
  fi
done

if [ ${#totals[@]} -gt 0 ]; then
  sum=0
  for t in "${totals[@]}"; do sum=$((sum + t)); done
  echo
  echo "Mean: $((sum / ${#totals[@]})) ms across ${#totals[@]} successful run(s)"
fi
