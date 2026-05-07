#!/usr/bin/env bash
#
# Cold-start + tab-navigation wall-clock timer.
#
# Where the existing perf-suite measures jank/frame deadlines via
# gfxinfo, this script answers the simpler question Ben actually feels:
# "after I kill the app and reopen it, how many seconds until I can use it?"
#
# Captured per run:
#   1. cold start    — `am start -W` TotalTime (system time-to-first-frame)
#   2. responsive    — wall clock between launch and the first
#                      `[Perf] refreshDmInbox` log line (LP's own marker
#                      saying the inbox refresh path settled)
#   3. tab nav       — Home → Messages → Learn → Friends, each tap
#                      timed end-to-end via a Maestro flow that uses
#                      `tab-<name>` testIDs (no coordinates per CLAUDE.md)
#
# Usage:
#   ./scripts/perf-startup.sh                           # 3 runs, Pixel default
#   SAMPLES=5 ./scripts/perf-startup.sh                 # more runs, less noise
#   DEVICE=emulator-5554 PKG=com.lightningpiggy.app.dev \
#     ./scripts/perf-startup.sh                         # AVD / dev variant
#
# Output: a markdown table of per-run + median measurements, plus the
# raw [Perf] logcat lines per sample so you can see k1059, fresh, hits,
# misses contributing to each refresh.

set -u

DEVICE="${DEVICE:-${PIXEL_DEVICE:-37111FDJH0067B}}"
PKG="${PKG:-${PIXEL_PKG:-com.lightningpiggy.app}}"
SAMPLES="${SAMPLES:-3}"
LAUNCH_TIMEOUT_S=60

OUT="/tmp/perf-startup-$(date +%s)"
mkdir -p "$OUT"

ADB="adb -s $DEVICE"

if ! $ADB shell pm path "$PKG" >/dev/null 2>&1; then
  echo "ERROR: package $PKG not installed on $DEVICE" >&2
  exit 1
fi

# Resolve the launcher activity automatically — works for either app variant.
LAUNCHER=$($ADB shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER "$PKG" 2>/dev/null | tail -1 | tr -d '\r')
if [[ -z "$LAUNCHER" || "$LAUNCHER" != */* ]]; then
  echo "ERROR: could not resolve launcher activity for $PKG" >&2
  exit 1
fi

echo "→ device:    $DEVICE"
echo "→ package:   $PKG"
echo "→ component: $LAUNCHER"
echo "→ samples:   $SAMPLES"
echo "→ writing:   $OUT"
echo

# ---- Maestro tab-tap flows --------------------------------------------------

write_tab_flow() {
  local tab=$1
  cat > "$OUT/tap-$tab.yaml" <<EOF
appId: $PKG
---
- tapOn:
    id: "tab-$tab"
EOF
}

for t in home messages learn friends; do
  write_tab_flow "$t"
done

# ---- helpers ----------------------------------------------------------------

now_ms() { date +%s%3N; }

# Wait until logcat shows a line matching $1 since timestamp $2 (HH:MM:SS.mmm).
# Returns elapsed ms or empty if it never matched within $LAUNCH_TIMEOUT_S.
wait_for_log() {
  local pattern=$1
  local since_ts=$2
  local start_ms=$3
  local deadline=$(( start_ms + LAUNCH_TIMEOUT_S * 1000 ))
  while [[ $(now_ms) -lt $deadline ]]; do
    if $ADB logcat -d -t "$since_ts" 2>/dev/null | grep -qE "$pattern"; then
      echo $(( $(now_ms) - start_ms ))
      return 0
    fi
    sleep 0.25
  done
  echo ""
}

# Tap a tab via Maestro and return ms to the next $2 log marker (or empty
# on timeout).  The Maestro process itself takes ~5–10 s of JVM warmup, so
# we time the *log marker*, not the maestro CLI exit; the marker is what
# matches the user's perceived "tab is now responsive" moment.
tap_and_time() {
  local tab=$1
  local marker=$2
  local since_ts=$3
  local t0
  t0=$(now_ms)
  maestro --device "$DEVICE" test "$OUT/tap-$tab.yaml" > "$OUT/maestro-$tab.log" 2>&1 &
  local maestro_pid=$!
  local elapsed
  elapsed=$(wait_for_log "$marker" "$since_ts" "$t0")
  wait "$maestro_pid" 2>/dev/null || true
  echo "$elapsed"
}

# ---- one full sample --------------------------------------------------------

declare -a ROWS=()

run_sample() {
  local n=$1
  echo "─── sample $n ───"

  $ADB logcat -c
  $ADB shell am force-stop "$PKG" >/dev/null 2>&1
  sleep 1

  local since_ts
  since_ts=$($ADB shell 'date +%m-%d\ %H:%M:%S.000' | tr -d '\r')
  local launch_start
  launch_start=$(now_ms)

  # `am start -W` blocks until the first frame; reports TotalTime / WaitTime.
  local launch_out total_time wait_time
  launch_out=$($ADB shell am start -W -n "$LAUNCHER" 2>&1 | tr -d '\r')
  total_time=$(echo "$launch_out" | awk '/^TotalTime:/ {print $2}')
  wait_time=$(echo  "$launch_out" | awk '/^WaitTime:/ {print $2}')

  # Time-to-responsive: first refreshDmInbox completion log.
  local responsive_ms
  responsive_ms=$(wait_for_log 'ReactNativeJS.*\[Perf\] refreshDmInbox' "$since_ts" "$launch_start")

  local home_ms="" msgs_ms="" learn_ms="" friends_ms=""
  if [[ -n "$responsive_ms" ]]; then
    sleep 0.5

    # Home tap — no unique perf marker, so we use a short fixed settle.
    # Document this caveat in the summary.
    local t0
    t0=$(now_ms)
    maestro --device "$DEVICE" test "$OUT/tap-home.yaml" > "$OUT/maestro-home.log" 2>&1 || true
    home_ms=$(( $(now_ms) - t0 ))

    msgs_ms=$(tap_and_time messages 'ReactNativeJS.*\[Perf\] refreshDmInbox' "$since_ts")

    t0=$(now_ms)
    maestro --device "$DEVICE" test "$OUT/tap-learn.yaml" > "$OUT/maestro-learn.log" 2>&1 || true
    learn_ms=$(( $(now_ms) - t0 ))

    friends_ms=$(tap_and_time friends 'ReactNativeJS.*\[Perf\] FriendsList first render' "$since_ts")
  fi

  echo "  cold_total=${total_time}ms  wait=${wait_time}ms  responsive=${responsive_ms:-TIMEOUT}ms"
  echo "  home=${home_ms:-—}ms  messages=${msgs_ms:-—}ms  learn=${learn_ms:-—}ms  friends=${friends_ms:-—}ms"

  $ADB logcat -d -t "$since_ts" 2>/dev/null \
    | grep -E "ReactNativeJS.*\[Perf\] (refreshDmInbox|nip17-cache|FriendsList first render|fetchProfiles|fetchInboxDmEvents)" \
    > "$OUT/sample-$n.log" 2>/dev/null || true

  ROWS+=("$n|${total_time:-—}|${wait_time:-—}|${responsive_ms:-—}|${home_ms:-—}|${msgs_ms:-—}|${learn_ms:-—}|${friends_ms:-—}")
}

# ---- median across N integer samples ---------------------------------------

median_of() {
  local clean=()
  for v in "$@"; do
    [[ "$v" =~ ^[0-9]+$ ]] && clean+=("$v")
  done
  if [[ ${#clean[@]} -eq 0 ]]; then echo "—"; return; fi
  IFS=$'\n' clean=($(printf '%s\n' "${clean[@]}" | sort -n)); unset IFS
  echo "${clean[$(( ${#clean[@]} / 2 ))]}"
}

# ---- run ---------------------------------------------------------------------

for n in $(seq 1 "$SAMPLES"); do
  run_sample "$n"
  sleep 1
done

# ---- summary table ---------------------------------------------------------

declare -a colA colB colC colD colE colF colG
for row in "${ROWS[@]}"; do
  IFS='|' read -r _ a b c d e f g <<<"$row"
  colA+=("$a"); colB+=("$b"); colC+=("$c"); colD+=("$d"); colE+=("$e"); colF+=("$f"); colG+=("$g")
done

{
  echo "# Cold-start + tab-nav timing — $(date '+%Y-%m-%d %H:%M:%S')"
  echo
  echo "device: \`$DEVICE\` · package: \`$PKG\` · samples: $SAMPLES"
  echo
  echo "| sample | TotalTime | WaitTime | time-to-responsive | tab-home | tab-messages | tab-learn | tab-friends |"
  echo "|--------|-----------|----------|--------------------|----------|--------------|-----------|-------------|"
  for row in "${ROWS[@]}"; do
    IFS='|' read -r n a b c d e f g <<<"$row"
    echo "| $n | ${a}ms | ${b}ms | ${c}ms | ${d}ms | ${e}ms | ${f}ms | ${g}ms |"
  done
  echo "| **median** | $(median_of "${colA[@]}")ms | $(median_of "${colB[@]}")ms | $(median_of "${colC[@]}")ms | $(median_of "${colD[@]}")ms | $(median_of "${colE[@]}")ms | $(median_of "${colF[@]}")ms | $(median_of "${colG[@]}")ms |"
  echo
  echo "Definitions:"
  echo "- **TotalTime** — Android's wall clock from \`am start\` to the first frame of the launched activity (system-side)."
  echo "- **WaitTime** — TotalTime + any pre-launch system overhead."
  echo "- **time-to-responsive** — wall clock from launch to the first \`[Perf] refreshDmInbox\` completion line. This is what the user *feels* — the screen is on, but new messages are still draining."
  echo "- **tab-messages** — wall clock from Maestro's tap dispatch to the next \`refreshDmInbox\` log line."
  echo "- **tab-friends** — wall clock from tap dispatch to the next \`FriendsList first render\` log line."
  echo "- **tab-home / tab-learn** — full Maestro-flow round-trip (~5 s JVM overhead included). Treat these as upper-bounds; they don't fire a unique perf line so we can't subtract Maestro out."
  echo
  echo "Per-sample logs in \`$OUT/sample-N.log\`."
} | tee "$OUT/summary.md"
