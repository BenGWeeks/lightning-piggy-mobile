#!/usr/bin/env bash
#
# Perf suite — runs gfxinfo measurements across the main user-facing
# surfaces and emits a markdown table. Intended for tracking perceived-
# perf regressions on the AVD across branches.
#
# Usage:
#   ./scripts/perf-suite.sh                     # default: 3 samples each
#   SAMPLES=5 ./scripts/perf-suite.sh           # more samples, less noise
#   DEVICE=emulator-5556 PKG=com.example.app ./scripts/perf-suite.sh
#
# Output:
#   /tmp/perf-suite-<unix-ts>/summary.md          markdown table
#   /tmp/perf-suite-<unix-ts>/<surface>-<n>.txt   per-sample gfxinfo dumps
#
# Surfaces measured (each from a cold app start):
#   - tab-home           Home tab tap after launch
#   - tab-messages       Messages tab tap after launch
#   - tab-friends        Friends tab tap after launch
#   - scroll-friends     12 swipes on Friends list (steady-state)
#   - scroll-messages    12 swipes on Messages list (steady-state)
#   - fab-open           FAB → FriendPickerSheet open
#
# Captured per sample:
#   - Total frames
#   - Modern jank % (dropped frames — the metric users feel)
#   - Legacy jank %  (sub-deadline frames — sensitive to "borderline" smoothness)
#   - 50th / 90th / 99th frame percentiles (CPU/UI thread)
#   - 99th GPU percentile
#   - Count of 4950 ms histogram bucket hits (AVD cold-init artifact)
#
# The table reports the median across N samples for each metric.

set -u

DEVICE="${DEVICE:-emulator-5554}"
PKG="${PKG:-com.lightningpiggy.app.dev}"
SAMPLES="${SAMPLES:-3}"
METRO_RELOAD_URL="${METRO_RELOAD_URL:-http://localhost:8081/reload}"

OUT="/tmp/perf-suite-$(date +%s)"
mkdir -p "$OUT"
echo "→ writing to $OUT (samples per surface: $SAMPLES, device: $DEVICE)"

# ---- Maestro flow templates -------------------------------------------------

write_flow() {
  local path=$1
  local body=$2
  printf "appId: %s\n%s\n" "$PKG" "$body" > "$path"
}

write_flow /tmp/perf-flow-tab-home.yaml "name: tap home
---
- launchApp:
    clearState: false
- waitForAnimationToEnd:
    timeout: 30000
- tapOn:
    id: 'tab-home'"

write_flow /tmp/perf-flow-tab-messages.yaml "name: tap messages
---
- launchApp:
    clearState: false
- waitForAnimationToEnd:
    timeout: 30000
- tapOn:
    id: 'tab-messages'"

write_flow /tmp/perf-flow-tab-friends.yaml "name: tap friends
---
- launchApp:
    clearState: false
- waitForAnimationToEnd:
    timeout: 30000
- tapOn:
    id: 'tab-friends'"

write_flow /tmp/perf-flow-warmup-friends.yaml "name: warmup friends
---
- launchApp:
    clearState: false
- waitForAnimationToEnd:
    timeout: 30000
- tapOn:
    id: 'tab-friends'
- waitForAnimationToEnd:
    timeout: 5000"

write_flow /tmp/perf-flow-warmup-messages.yaml "name: warmup messages
---
- launchApp:
    clearState: false
- waitForAnimationToEnd:
    timeout: 30000
- tapOn:
    id: 'tab-messages'
- waitForAnimationToEnd:
    timeout: 5000"

write_flow /tmp/perf-flow-swipes.yaml "name: 10 swipes
---
- swipe:
    direction: UP
    duration: 400
- swipe:
    direction: UP
    duration: 400
- swipe:
    direction: UP
    duration: 400
- swipe:
    direction: DOWN
    duration: 400
- swipe:
    direction: DOWN
    duration: 400
- swipe:
    direction: DOWN
    duration: 400
- swipe:
    direction: UP
    duration: 400
- swipe:
    direction: UP
    duration: 400
- swipe:
    direction: DOWN
    duration: 400
- swipe:
    direction: DOWN
    duration: 400"

write_flow /tmp/perf-flow-fab.yaml "name: tap FAB
---
- tapOn:
    id: 'start-conversation-button'
- waitForAnimationToEnd:
    timeout: 3000"

# ---- Sample primitives ------------------------------------------------------

reset_gfx() { adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" reset > /dev/null 2>&1 || true; }
snap_gfx()  { adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" > "$1" 2>&1 || true; }
cold_start() { curl -s -X POST "$METRO_RELOAD_URL" >/dev/null 2>&1; adb -s "$DEVICE" shell am force-stop "$PKG"; }

# Run one cold-tab-tap sample. Resets gfxinfo BEFORE the maestro flow so the
# capture covers app launch + tab tap + first paint. Caveat noted: this
# includes cold Skia init costs that are emulator-specific; that's why we
# also have a "scroll" measurement (steady-state, post-warmup).
sample_cold_tap() {
  local label=$1 flow=$2 out=$3
  reset_gfx
  maestro --device "$DEVICE" test "$flow" > "$out.maestro.log" 2>&1 || return 1
  sleep 3
  snap_gfx "$out.gfxinfo.txt"
}

# Two-phase: warmup runs first (so cold-mount frames are NOT counted), then
# we reset gfxinfo, then the action flow runs and we capture only its frames.
# This is the right way to measure scroll perf or sheet-open perf without
# emulator cold-init noise.
sample_steady() {
  local label=$1 warmup=$2 action=$3 out=$4
  maestro --device "$DEVICE" test "$warmup" > "$out.warmup.log" 2>&1 || return 1
  reset_gfx
  maestro --device "$DEVICE" test "$action" > "$out.action.log" 2>&1 || return 1
  sleep 2
  snap_gfx "$out.gfxinfo.txt"
}

# ---- Metric extraction ------------------------------------------------------

extract() {
  # Portable parser using grep + sed (no GAWK-only `match(... ,arr)`).
  # Emits one pipe-separated row: tot|modern|legacy|p50|p90|p99|gpu99|stalls
  local file=$1
  local tot modern legacy p50 p90 p99 gpu99 stalls
  tot=$(grep -m1 'Total frames rendered:' "$file" | awk '{print $NF}')
  modern=$(grep '^[[:space:]]*Janky frames:' "$file" | head -1 | sed -nE 's/.*\(([0-9.]+)%\).*/\1/p')
  legacy=$(grep 'Janky frames (legacy):' "$file" | head -1 | sed -nE 's/.*\(([0-9.]+)%\).*/\1/p')
  p50=$(grep -m1 '^[[:space:]]*50th percentile:' "$file" | sed -nE 's/.*: ([0-9]+)ms.*/\1/p')
  p90=$(grep -m1 '^[[:space:]]*90th percentile:' "$file" | sed -nE 's/.*: ([0-9]+)ms.*/\1/p')
  p99=$(grep -m1 '^[[:space:]]*99th percentile:' "$file" | sed -nE 's/.*: ([0-9]+)ms.*/\1/p')
  gpu99=$(grep -m1 '99th gpu percentile:' "$file" | sed -nE 's/.*: ([0-9]+)ms.*/\1/p')
  # Count of frames in the 4950ms histogram bucket (CPU side; GPU side
  # reported separately via gpu99). Looks for "4950ms=N" anywhere in
  # the file and sums all matches (the cpu HISTOGRAM line + the
  # GPU HISTOGRAM line both can have it).
  stalls=$(grep -oE '4950ms=[0-9]+' "$file" | head -2 | sed -E 's/4950ms=//' | paste -sd+ | bc 2>/dev/null)
  printf "%s|%s|%s|%s|%s|%s|%s|%s\n" \
    "${tot:-0}" "${modern:-0}" "${legacy:-0}" \
    "${p50:-0}" "${p90:-0}" "${p99:-0}" "${gpu99:-0}" "${stalls:-0}"
}

# Median of newline-separated numeric values, portable across mawk/gawk.
median() {
  local sorted
  sorted=$(sort -n)
  local n
  n=$(printf '%s\n' "$sorted" | grep -c .)
  if [ "$n" = "0" ] || [ -z "$sorted" ]; then printf "n/a"; return; fi
  local mid=$(( (n + 1) / 2 ))
  if [ $((n % 2)) = "1" ]; then
    printf '%s' "$(printf '%s\n' "$sorted" | sed -n "${mid}p")"
  else
    local a b
    a=$(printf '%s\n' "$sorted" | sed -n "$((n/2))p")
    b=$(printf '%s\n' "$sorted" | sed -n "$((n/2+1))p")
    awk -v a="$a" -v b="$b" 'BEGIN { printf "%.1f", (a+b)/2 }'
  fi
}

# ---- Run a surface (N samples + median + table row) ------------------------

run_surface() {
  local key=$1 label=$2 mode=$3 arg1=$4 arg2=${5:-}
  echo "→ $label ($SAMPLES samples)"
  rm -f "$OUT/$key-"*
  for i in $(seq 1 "$SAMPLES"); do
    cold_start
    local stem="$OUT/$key-$i"
    if [ "$mode" = "cold-tap" ]; then
      sample_cold_tap "$label" "$arg1" "$stem" || { echo "  ✗ sample $i failed"; continue; }
    else
      sample_steady "$label" "$arg1" "$arg2" "$stem" || { echo "  ✗ sample $i failed"; continue; }
    fi
  done
  # Aggregate
  local tots=() modj=() legj=() p50s=() p90s=() p99s=() gpus=() stalls=()
  for f in "$OUT/$key-"*.gfxinfo.txt; do
    [ -f "$f" ] || continue
    IFS='|' read -r tot mod leg p50 p90 p99 gpu st <<< "$(extract "$f")"
    tots+=("$tot"); modj+=("$mod"); legj+=("$leg")
    p50s+=("${p50%ms}"); p90s+=("${p90%ms}"); p99s+=("${p99%ms}")
    gpus+=("${gpu%ms}"); stalls+=("$st")
  done
  local mTot=$(printf '%s\n' "${tots[@]}" | median)
  local mMod=$(printf '%s\n' "${modj[@]}" | median)
  local mLeg=$(printf '%s\n' "${legj[@]}" | median)
  local mP50=$(printf '%s\n' "${p50s[@]}" | median)
  local mP90=$(printf '%s\n' "${p90s[@]}" | median)
  local mP99=$(printf '%s\n' "${p99s[@]}" | median)
  local mGpu=$(printf '%s\n' "${gpus[@]}" | median)
  local mStl=$(printf '%s\n' "${stalls[@]}" | median)
  echo "| $label | $mTot | ${mMod}% | ${mLeg}% | ${mP50}ms | ${mP90}ms | ${mP99}ms | ${mGpu}ms | $mStl |" >> "$OUT/summary.md.tmp"
}

# ---- Suite ------------------------------------------------------------------

cat > "$OUT/summary.md" <<EOF
# perf-suite report

| Setting | Value |
|---|---|
| Device | \`$DEVICE\` |
| Package | \`$PKG\` |
| Samples per surface | $SAMPLES |
| Run timestamp | $(date -u +"%Y-%m-%dT%H:%M:%SZ") |
| Branch | $(git branch --show-current 2>/dev/null || echo "unknown") |
| HEAD | $(git log -1 --format='%h %s' 2>/dev/null || echo "unknown") |

## Median results

| Surface | Frames | **Modern jank** | Legacy jank | 50th | 90th | **99th** | GPU 99th | 4950ms hits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
EOF

run_surface "tab-home"        "Home tab cold tap"       "cold-tap" /tmp/perf-flow-tab-home.yaml
run_surface "tab-messages"    "Messages tab cold tap"   "cold-tap" /tmp/perf-flow-tab-messages.yaml
run_surface "tab-friends"     "Friends tab cold tap"    "cold-tap" /tmp/perf-flow-tab-friends.yaml
run_surface "scroll-friends"  "Friends list scroll"     "steady"   /tmp/perf-flow-warmup-friends.yaml /tmp/perf-flow-swipes.yaml
run_surface "scroll-messages" "Messages list scroll"    "steady"   /tmp/perf-flow-warmup-messages.yaml /tmp/perf-flow-swipes.yaml
run_surface "fab-open"        "FAB → FriendPicker open" "steady"   /tmp/perf-flow-warmup-messages.yaml /tmp/perf-flow-fab.yaml

cat "$OUT/summary.md.tmp" >> "$OUT/summary.md"
rm -f "$OUT/summary.md.tmp"

cat >> "$OUT/summary.md" <<EOF

## Targets

- **Modern jank** (frames the user actually saw drop): under **5%** is excellent, under **10%** is acceptable.
- **99th frame percentile**: under **33ms** = no perceptible single-frame stutters; over **100ms** = visible hitches.
- **GPU 99th = 4950ms** is the AVD's emulator-floor (cold Skia / RenderThread init). Reproducible on every cold start regardless of code; treat the count of 4950ms hits as the signal, not the percentile itself.

## Caveats

- AVD x86 dev mode is 3-5× slower than a release build on a real device. Treat absolute numbers as upper bounds; the relative deltas branch-vs-branch are the meaningful signal.
- Single-run noise on \`Janky frames (legacy) %\` can swing 10-30 percentage points. Sample size $SAMPLES (set via \`SAMPLES=\` env). Higher = less noise.
- Cold-tap measurements include app-launch and Skia init costs. The "scroll" rows isolate steady-state UI work.

EOF

echo ""
echo "✓ done — see $OUT/summary.md"
echo ""
cat "$OUT/summary.md"
