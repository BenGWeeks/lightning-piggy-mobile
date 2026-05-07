#!/usr/bin/env bash
#
# Time-to-first-contact-profile-sheet wall-clock timer.
#
# Where perf-startup.sh measures cold-start + tab-nav, this script answers
# the next-step question: after I tap the first contact in Friends, how long
# until the profile bottom sheet is rendered? The bottleneck this targets is
# the chain FriendsScreen mount -> first paint -> tap latency ->
# ContactProfileSheet mount + animation.
#
# Captured per run:
#   1. cold start            — `am start -W` TotalTime
#   2. tab-friends           — wall clock from tap dispatch on tab-friends
#                              to the first `[Perf] FriendsList first render`
#                              log line (matches perf-startup.sh's metric).
#   3. profile-sheet         — wall clock from tap dispatch on the first
#                              contact list row to the first
#                              `[Perf] ContactProfileSheet first render`
#                              log line.
#
# Usage:
#   ./scripts/perf-friends-profile-sheet.sh                           # 3 runs
#   SAMPLES=5 ./scripts/perf-friends-profile-sheet.sh                 # more runs
#   DEVICE=emulator-5554 PKG=com.lightningpiggy.app.dev \
#     ./scripts/perf-friends-profile-sheet.sh                         # AVD
#   FIRST_CONTACT_TEXT="Alice" ./scripts/perf-friends-profile-sheet.sh # custom seed
#
# Output: a markdown table of per-run + median measurements, plus the raw
# [Perf] logcat lines per sample.
#
# Helpers (now_ms / wait_for_log / tap_and_time / write_tab_flow) are
# duplicated from perf-startup.sh until a shared lib refactor.

set -u

DEVICE="${DEVICE:-${PIXEL_DEVICE:-37111FDJH0067B}}"
PKG="${PKG:-${PIXEL_PKG:-com.lightningpiggy.app}}"
SAMPLES="${SAMPLES:-3}"
LAUNCH_TIMEOUT_S=60

OUT="/tmp/perf-friends-profile-sheet-$(date +%s)"
mkdir -p "$OUT"

ADB="adb -s $DEVICE"

if ! $ADB shell pm path "$PKG" >/dev/null 2>&1; then
  echo "ERROR: package $PKG not installed on $DEVICE" >&2
  exit 1
fi

# Dev variant fetches its JS bundle from Metro at localhost:8081. Idempotent on prod.
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

# ---- Maestro flows ---------------------------------------------------------

# Tap the Friends tab.
cat > "$OUT/tap-friends.yaml" <<EOF
appId: $PKG
---
- tapOn:
    id: "tab-friends"
EOF

# Tap the first contact row. Maestro doesn't have a generic "first item"
# selector, the FlashList currently lacks a `friends-list` testID, and
# ContactListItem rows lack per-row testIDs, so we tap by text matching
# one of the seeded fixture contacts. Override via FIRST_CONTACT_TEXT to
# point at a contact you know exists on the device under test. Brittle
# but acceptable for a perf script run by humans, not CI. When a
# `friends-list` testID lands, switch to: `tapOn: { childOf: { id: "friends-list" }, index: 0 }`.
FIRST_CONTACT_TEXT="${FIRST_CONTACT_TEXT:-Big Piggy}"
cat > "$OUT/tap-first-contact.yaml" <<EOF
appId: $PKG
---
- tapOn:
    text: "$FIRST_CONTACT_TEXT"
EOF

# Warm Maestro before sample 1 so its JVM cold-start (~5–10 s) is paid
# during warmup rather than billed to sample 1's tab-friends column.
if ! maestro --version >/dev/null 2>&1; then
  echo "WARN: maestro not on PATH — tab + sheet columns will time out" >&2
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

# ---- helpers (duplicated from perf-startup.sh) -----------------------------

# `date +%s%3N` requires GNU date (Linux). Detect once and fall back to
# python3 (POSIX-portable) on macOS BSD date.
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

# Run a Maestro flow and return ms to the next $marker log line (or empty
# on timeout). The since_ts is computed fresh right before maestro fires
# so wait_for_log only matches markers emitted AFTER tap dispatch.
run_flow_and_time() {
  local flow=$1
  local marker=$2
  local logname=$3
  local fresh_since_ts
  fresh_since_ts=$($ADB shell 'date +%m-%d\ %H:%M:%S.000' | tr -d '\r')
  local t0
  t0=$(now_ms)
  maestro --device "$DEVICE" test "$OUT/$flow" > "$OUT/maestro-$logname.log" 2>&1 &
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

  # Small fixed settle for the cold-start UI to render before tapping.
  sleep 1.5

  local friends_ms sheet_ms

  # 1) Tap Friends tab — time to FriendsList first-render marker.
  friends_ms=$(run_flow_and_time tap-friends.yaml \
    'ReactNativeJS.*\[Perf\] FriendsList first render' \
    friends)

  # 2) Tap the first contact row — time to ContactProfileSheet first-render marker.
  sheet_ms=$(run_flow_and_time tap-first-contact.yaml \
    'ReactNativeJS.*\[Perf\] ContactProfileSheet first render' \
    profile-sheet)

  echo "  cold_total=${total_time}ms  wait=${wait_time}ms"
  echo "  tab-friends=${friends_ms:-—}ms  profile-sheet=${sheet_ms:-—}ms"

  $ADB logcat -d -t "$since_ts" 2>/dev/null \
    | grep -E "ReactNativeJS.*\[Perf\] (FriendsList first render|ContactProfileSheet first render|fetchProfiles)" \
    > "$OUT/sample-$n.log" 2>/dev/null || true

  ROWS+=("$n|${total_time:-—}|${wait_time:-—}|${friends_ms:-—}|${sheet_ms:-—}")
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

# ---- run --------------------------------------------------------------------

for n in $(seq 1 "$SAMPLES"); do
  run_sample "$n"
  sleep 1
done

# ---- summary table ----------------------------------------------------------

declare -a colA colB colF colS
for row in "${ROWS[@]}"; do
  IFS='|' read -r _ a b f s <<<"$row"
  colA+=("$a"); colB+=("$b"); colF+=("$f"); colS+=("$s")
done

{
  echo "# Time-to-first-contact-profile-sheet — $(date '+%Y-%m-%d %H:%M:%S')"
  echo
  echo "device: \`$DEVICE\` · package: \`$PKG\` · samples: $SAMPLES"
  echo
  echo "| sample | TotalTime | WaitTime | tab-friends | profile-sheet |"
  echo "|--------|-----------|----------|-------------|---------------|"
  for row in "${ROWS[@]}"; do
    IFS='|' read -r n a b f s <<<"$row"
    echo "| $n | ${a}ms | ${b}ms | ${f}ms | ${s}ms |"
  done
  echo "| **median** | $(median_of "${colA[@]}")ms | $(median_of "${colB[@]}")ms | $(median_of "${colF[@]}")ms | $(median_of "${colS[@]}")ms |"
  echo
  echo "Definitions:"
  echo "- **TotalTime** — Android's wall clock from \`am start\` to the first frame of the launched activity."
  echo "- **WaitTime** — TotalTime + any pre-launch system overhead."
  echo "- **tab-friends** — wall clock from \`maestro test\` invocation (tap on \`tab-friends\`) to the next \`[Perf] FriendsList first render\` log line. Includes Maestro's per-invocation JVM cost as a constant baseline."
  echo "- **profile-sheet** — wall clock from \`maestro test\` invocation (tap on the first contact row) to the next \`[Perf] ContactProfileSheet first render\` log line. This is the user-perceived latency of opening a profile."
  echo
  echo "Per-sample logs in \`$OUT/sample-N.log\`."
} | tee "$OUT/summary.md"
