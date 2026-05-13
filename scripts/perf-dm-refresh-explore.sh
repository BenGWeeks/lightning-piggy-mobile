#!/usr/bin/env bash
# Perf measurement: pull-to-refresh Messages contended with immediate
# Explore-tab switch. Demonstrates the JS-thread unblock from PR #533
# (NIP-17 decrypt yield-budget).
#
# Usage:
#   ./scripts/perf-dm-refresh-explore.sh                    # 3 samples default
#   SAMPLES=5 ./scripts/perf-dm-refresh-explore.sh
#   PKG=com.lightningpiggy.app.dev ./scripts/perf-dm-refresh-explore.sh
#   DEVICE=37111FDJH0067B ./scripts/perf-dm-refresh-explore.sh
#
# Defaults:
#   DEVICE   emulator-5554       (override for Pixel: 37111FDJH0067B)
#   PKG      com.lightningpiggy.app.preview
#                                (preview is the only channel with
#                                EXPO_PUBLIC_KEEP_PERF_LOGS=1 baked in)
#   SAMPLES  3
#
# Output (in /tmp/perf-dm-refresh-explore-<unix-ts>/):
#   sample-N.gfxinfo.txt   raw gfxinfo dump post-flow
#   sample-N.maestro.log   Maestro log
#   summary.md             markdown table compatible with perf-suite.sh

set -u

DEVICE="${DEVICE:-emulator-5554}"
PKG="${PKG:-com.lightningpiggy.app.preview}"
SAMPLES="${SAMPLES:-3}"
METRO_RELOAD_URL="${METRO_RELOAD_URL:-http://localhost:8081/reload}"

# Source flow lives in tests/e2e/. We rewrite the appId on-the-fly so
# PKG overrides work without editing the YAML.
SRC_FLOW="tests/e2e/perf-dm-refresh-explore-mount.yaml"
if [ ! -f "$SRC_FLOW" ]; then
  echo "✗ flow not found: $SRC_FLOW" >&2
  exit 1
fi

OUT="/tmp/perf-dm-refresh-explore-$(date +%s)"
mkdir -p "$OUT"
FLOW="$OUT/flow.yaml"
# `appId:` is the first non-empty line — swap whatever it is for $PKG.
sed -E "s|^appId: .*|appId: $PKG|" "$SRC_FLOW" > "$FLOW"

echo "→ writing to $OUT (samples: $SAMPLES, device: $DEVICE, pkg: $PKG)"

# ---- helpers (mirror perf-suite.sh) -----------------------------------------

reset_gfx() { adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" reset > /dev/null 2>&1 || true; }
snap_gfx()  { adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" > "$1" 2>&1 || true; }
cold_start() { curl -s -X POST "$METRO_RELOAD_URL" >/dev/null 2>&1; adb -s "$DEVICE" shell am force-stop "$PKG"; }

# Extract one pipe-separated row of gfxinfo metrics — identical parser
# to perf-suite.sh so the summary.md row aligns column-for-column.
extract() {
  local file=$1
  local tot modern legacy p50 p90 p99 gpu99 stalls
  tot=$(grep -m1 'Total frames rendered:' "$file" | awk '{print $NF}')
  modern=$(grep '^[[:space:]]*Janky frames:' "$file" | head -1 | sed -nE 's/.*\(([0-9.]+)%\).*/\1/p')
  legacy=$(grep 'Janky frames (legacy):' "$file" | head -1 | sed -nE 's/.*\(([0-9.]+)%\).*/\1/p')
  p50=$(grep -m1 '^[[:space:]]*50th percentile:' "$file" | sed -nE 's/.*: ([0-9]+)ms.*/\1/p')
  p90=$(grep -m1 '^[[:space:]]*90th percentile:' "$file" | sed -nE 's/.*: ([0-9]+)ms.*/\1/p')
  p99=$(grep -m1 '^[[:space:]]*99th percentile:' "$file" | sed -nE 's/.*: ([0-9]+)ms.*/\1/p')
  gpu99=$(grep -m1 '99th gpu percentile:' "$file" | sed -nE 's/.*: ([0-9]+)ms.*/\1/p')
  stalls=$(grep -oE '4950ms=[0-9]+' "$file" | head -2 | sed -E 's/4950ms=//' | paste -sd+ | bc 2>/dev/null)
  printf "%s|%s|%s|%s|%s|%s|%s|%s\n" \
    "${tot:-0}" "${modern:-0}" "${legacy:-0}" \
    "${p50:-0}" "${p90:-0}" "${p99:-0}" "${gpu99:-0}" "${stalls:-0}"
}

median() {
  local sorted; sorted=$(sort -n)
  local n; n=$(printf '%s\n' "$sorted" | grep -c .)
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

# ---- samples ----------------------------------------------------------------

for i in $(seq 1 "$SAMPLES"); do
  echo "→ sample $i"
  cold_start
  sleep 2
  # Launch the app + tap Messages happens inside the Maestro flow.
  # We pre-warm by running the flow once with reset BEFORE the swipe.
  # Approach: split into pre-warm (launch+messages) and measured
  # (swipe+tab-switch). Simpler: run the whole flow, but reset gfxinfo
  # mid-flow via a poll. Maestro doesn't have a "callback" hook for
  # that — so the next-cleanest is to reset just before invoking
  # Maestro (so the captured window covers Maestro launch + tab tap
  # + swipe + Explore mount). The launch portion adds a small
  # constant of frames; per-sample delta still dominates.
  reset_gfx
  maestro --device "$DEVICE" test "$FLOW" > "$OUT/sample-$i.maestro.log" 2>&1 || {
    echo "  ✗ sample $i Maestro failed — see $OUT/sample-$i.maestro.log"
    continue
  }
  sleep 2
  snap_gfx "$OUT/sample-$i.gfxinfo.txt"
done

# ---- aggregate --------------------------------------------------------------

tots=() modj=() legj=() p50s=() p90s=() p99s=() gpus=() stalls=()
for f in "$OUT"/sample-*.gfxinfo.txt; do
  [ -f "$f" ] || continue
  IFS='|' read -r tot mod leg p50 p90 p99 gpu st <<< "$(extract "$f")"
  tots+=("$tot"); modj+=("$mod"); legj+=("$leg")
  p50s+=("${p50%ms}"); p90s+=("${p90%ms}"); p99s+=("${p99%ms}")
  gpus+=("${gpu%ms}"); stalls+=("$st")
done
mTot=$(printf '%s\n' "${tots[@]}"   | median)
mMod=$(printf '%s\n' "${modj[@]}"   | median)
mLeg=$(printf '%s\n' "${legj[@]}"   | median)
mP50=$(printf '%s\n' "${p50s[@]}"   | median)
mP90=$(printf '%s\n' "${p90s[@]}"   | median)
mP99=$(printf '%s\n' "${p99s[@]}"   | median)
mGpu=$(printf '%s\n' "${gpus[@]}"   | median)
mStl=$(printf '%s\n' "${stalls[@]}" | median)

cat > "$OUT/summary.md" <<EOF
# perf — DM refresh + Explore mount

| Setting | Value |
|---|---|
| Device | \`$DEVICE\` |
| Package | \`$PKG\` |
| Samples | $SAMPLES |
| Run timestamp | $(date -u +"%Y-%m-%dT%H:%M:%SZ") |
| Branch | $(git branch --show-current 2>/dev/null || echo "unknown") |
| HEAD | $(git log -1 --format='%h %s' 2>/dev/null || echo "unknown") |

## Median results

| Surface | Frames | **Modern jank** | Legacy jank | 50th | 90th | **99th** | GPU 99th | 4950ms hits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| DM refresh → Explore mount | $mTot | ${mMod}% | ${mLeg}% | ${mP50}ms | ${mP90}ms | ${mP99}ms | ${mGpu}ms | $mStl |

## Notes

- The captured window covers: app launch + Messages-tab tap + pull-to-refresh swipe + Explore-tab tap + first paint.
- Pre-#533 baseline: pull-to-refresh held the JS thread through the NIP-17 decrypt batch, blocking Explore's first paint. Expect high legacy-jank% + a long 99th-percentile frame.
- Post-#533: the decrypt yield-budget should let the tab-switch frames slip in between batches. Modern jank% should drop closer to the steady-state \`tab-explore\` numbers in the main perf suite.
- No baked-in threshold — this run emits numbers we A/B vs the main perf-suite \`tab-explore\` row on the same device + sample size.
EOF

echo ""
echo "✓ done — see $OUT/summary.md"
echo ""
cat "$OUT/summary.md"
