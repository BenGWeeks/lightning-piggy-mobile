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

# Dev variant fetches its JS bundle from Metro at localhost:8081. Without an adb reverse, the device's `localhost` resolves to the device itself and the bundle fetch fails — every sample times out before any [Perf] markers fire. Idempotent on prod where Metro is irrelevant.
$ADB reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true

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

for t in messages learn friends; do
  write_tab_flow "$t"
done
# tab-home is intentionally not measured per tap: Home is the default tab so it mounts during cold-start, its `[Perf] HomeScreen first render` marker fires once at app launch, and tapping the Home tab afterwards (with `freezeOnBlur: true` keeping it mounted) does not trigger a re-render or re-fire the marker. The cold-start time-to-Home is implicitly captured in `time-to-wallet` / `time-to-responsive` already.

# Warm Maestro before sample 1 — every `maestro test` invocation pays a fresh JVM cold-start (~5–10 s on Linux). Running a no-op flow once at the start "burns" that cost into the warmup phase rather than into sample 1's tab-home column. Subsequent tests reuse the same daemon-cached JVM via Maestro 2.x's daemon mode.
if ! maestro --version >/dev/null 2>&1; then
  echo "WARN: maestro not on PATH — tab-nav columns will time out" >&2
else
  echo "→ warming Maestro (one-shot no-op flow)..."
  cat > "$OUT/warmup.yaml" <<EOF
appId: $PKG
---
- launchApp:
    clearState: false
EOF
  maestro --device "$DEVICE" test "$OUT/warmup.yaml" >"$OUT/maestro-warmup.log" 2>&1 || true
fi

# ---- helpers ----------------------------------------------------------------

# `date +%s%3N` requires GNU date (Linux). macOS BSD `date` doesn't expand `%N`, so contributors running this from macOS would get bad timings. Detect once at script load and fall back to python3 (POSIX-portable) when GNU date is unavailable.
if date +%N 2>/dev/null | grep -qE '^[0-9]{9}$'; then
  now_ms() { date +%s%3N; }
else
  now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
fi

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
#
# The since_ts arg is IGNORED — we compute a fresh device-side timestamp
# right before invoking maestro so wait_for_log only matches markers
# emitted AFTER tap dispatch. The previous shape used the sample-wide
# since_ts and matched markers that fired during cold-start (before any
# tap), which was especially wrong for tab-home because Home is the
# initial tab and HomeScreen's first-render marker fires during launch.
tap_and_time() {
  local tab=$1
  local marker=$2
  local fresh_since_ts
  fresh_since_ts=$($ADB shell 'date +%m-%d\ %H:%M:%S.000' | tr -d '\r')
  local t0
  t0=$(now_ms)
  maestro --device "$DEVICE" test "$OUT/tap-$tab.yaml" > "$OUT/maestro-$tab.log" 2>&1 &
  local maestro_pid=$!
  local elapsed
  elapsed=$(wait_for_log "$marker" "$fresh_since_ts" "$t0")
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

  # Time-to-wallet-connected: first NWC handshake success log. The marker is logged from WalletContext on the first wallet to flip to isConnected: true, with the elapsed reported as ms-since-JS-bundle-load (close enough to "from app launch" for a wall-clock signal). Tracks issue #410.
  local wallet_ms
  wallet_ms=$(wait_for_log 'ReactNativeJS.*\[Perf\] wallet connected' "$since_ts" "$launch_start")

  # Time-to-responsive: first refreshDmInbox completion log.
  local responsive_ms
  responsive_ms=$(wait_for_log 'ReactNativeJS.*\[Perf\] refreshDmInbox' "$since_ts" "$launch_start")

  # Tab-nav timing always runs — refreshDmInbox doesn't fire on cold-start (it only fires once Messages is opened), so gating tab-nav on time-to-responsive previously left the columns blank. Tabs are independently useful: tab-messages itself fires refreshDmInbox, tab-friends fires the FriendsList marker, and tab-home/tab-learn measure the Maestro round-trip as an upper bound. We give a small fixed settle for the cold-start UI to render before tapping.
  sleep 1.5

  local msgs_ms learn_ms friends_ms

  # Each tab times "tap dispatch → screen first commits its initial render", using a `[Perf] X first render` marker each tab screen logs once on mount. tap_and_time computes a fresh device-side `since_ts` at tap dispatch so log lines emitted before the tap (e.g. HomeScreen's marker during cold-start) don't false-positive the wait. Maestro JVM cold-start (~5–10 s per invocation) is in every measurement as a constant baseline; before/after comparisons within the same script run are still valid because that baseline cancels.
  msgs_ms=$(tap_and_time messages 'ReactNativeJS.*\[Perf\] MessagesScreen first render')
  learn_ms=$(tap_and_time learn 'ReactNativeJS.*\[Perf\] LearnScreen first render')
  friends_ms=$(tap_and_time friends 'ReactNativeJS.*\[Perf\] FriendsList first render')

  echo "  cold_total=${total_time}ms  wait=${wait_time}ms  wallet=${wallet_ms:-TIMEOUT}ms  responsive=${responsive_ms:-TIMEOUT}ms"
  echo "  messages=${msgs_ms:-—}ms  learn=${learn_ms:-—}ms  friends=${friends_ms:-—}ms"

  $ADB logcat -d -t "$since_ts" 2>/dev/null \
    | grep -E "ReactNativeJS.*\[Perf\] (wallet connected|refreshDmInbox|nip17-cache|HomeScreen first render|MessagesScreen first render|LearnScreen first render|FriendsList first render|fetchProfiles|fetchInboxDmEvents)" \
    > "$OUT/sample-$n.log" 2>/dev/null || true

  ROWS+=("$n|${total_time:-—}|${wait_time:-—}|${wallet_ms:-—}|${responsive_ms:-—}|${msgs_ms:-—}|${learn_ms:-—}|${friends_ms:-—}")
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

declare -a colA colB colW colC colE colF colG
for row in "${ROWS[@]}"; do
  IFS='|' read -r _ a b w c e f g <<<"$row"
  colA+=("$a"); colB+=("$b"); colW+=("$w"); colC+=("$c"); colE+=("$e"); colF+=("$f"); colG+=("$g")
done

{
  echo "# Cold-start + tab-nav timing — $(date '+%Y-%m-%d %H:%M:%S')"
  echo
  echo "device: \`$DEVICE\` · package: \`$PKG\` · samples: $SAMPLES"
  echo
  echo "| sample | TotalTime | WaitTime | time-to-wallet | time-to-responsive | tab-messages | tab-learn | tab-friends |"
  echo "|--------|-----------|----------|----------------|--------------------|--------------|-----------|-------------|"
  for row in "${ROWS[@]}"; do
    IFS='|' read -r n a b w c e f g <<<"$row"
    echo "| $n | ${a}ms | ${b}ms | ${w}ms | ${c}ms | ${e}ms | ${f}ms | ${g}ms |"
  done
  echo "| **median** | $(median_of "${colA[@]}")ms | $(median_of "${colB[@]}")ms | $(median_of "${colW[@]}")ms | $(median_of "${colC[@]}")ms | $(median_of "${colE[@]}")ms | $(median_of "${colF[@]}")ms | $(median_of "${colG[@]}")ms |"
  echo
  echo "Definitions:"
  echo "- **TotalTime** — Android's wall clock from \`am start\` to the first frame of the launched activity (system-side)."
  echo "- **WaitTime** — TotalTime + any pre-launch system overhead."
  echo "- **time-to-wallet** — wall clock from launch to the first \`[Perf] wallet connected\` line — i.e. how long until the active NWC wallet flips from Disconnected to Connected. Tracks issue #410."
  echo "- **time-to-responsive** — wall clock from launch to the first \`[Perf] refreshDmInbox\` completion line. This is what the user *feels* — the screen is on, but new messages are still draining."
  echo "- **tab-X** — wall clock from \`maestro test\` invocation to the next \`[Perf] X first render\` log line. Includes Maestro's per-invocation JVM cold-start (~5–10 s) as a constant baseline; before/after comparisons of the same metric within one run are still valid."
  echo
  echo "Per-sample logs in \`$OUT/sample-N.log\`."
} | tee "$OUT/summary.md"
