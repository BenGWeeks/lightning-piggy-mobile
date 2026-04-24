#!/usr/bin/env bash
# Shared helpers for Maestro-driven perf scripts. Sourced, not executed.
#
# Env knobs (override at the call site):
#   DEVICE   - adb device serial (default: first attached device)
#   PKG      - Android package id (default: com.lightningpiggy.app)
#   PEER     - display name of a followed test peer, e.g. "Little Piggy"
#   GREETING - text guaranteed to render on Home (e.g. "Hello" from greeting)
#   SEED     - a substring unique to a message in the chosen thread
#              (default "[seed-" — matches the in-repo seed-script rumors)
#
# Requires: adb, maestro, awk, date(+%s%N).

set +e

DEVICE="${DEVICE:-$(adb devices | awk 'NR>1 && $2=="device" { print $1; exit }')}"
PKG="${PKG:-com.lightningpiggy.app}"
PEER="${PEER:-Little Piggy}"
GREETING="${GREETING:-Hello}"
SEED="${SEED:-[seed-}"

if [ -z "$DEVICE" ]; then
  echo "No adb device attached. Plug in / start an emulator and retry." >&2
  exit 1
fi

LOGDIR="${LOGDIR:-/tmp/piggy-perf}"
mkdir -p "$LOGDIR"

now_ns() { date +%s%N; }
now_hms() { date '+%H:%M:%S'; }

run_maestro() {
  # Usage: run_maestro <yaml>. Returns maestro's exit code.
  maestro --device "$DEVICE" test "$1" > "$LOGDIR/_maestro.out" 2>&1
}

require_app_running() {
  local pid
  pid=$(adb -s "$DEVICE" shell pidof "$PKG" | tr -d '\r')
  if [ -z "$pid" ]; then
    echo "App $PKG not running on $DEVICE. Launch it manually and retry." >&2
    exit 1
  fi
  echo "$pid"
}

start_logcat() {
  # Usage: start_logcat <pid> <logfile>. Sets LOGCAT_PID.
  local pid="$1" logfile="$2"
  adb -s "$DEVICE" logcat -c
  adb -s "$DEVICE" logcat --pid="$pid" -v time > "$logfile" 2>&1 &
  LOGCAT_PID=$!
}

stop_logcat() {
  [ -n "${LOGCAT_PID:-}" ] && kill "$LOGCAT_PID" 2>/dev/null
}

# Emit one timed step row: "<label> <ms> <OK/FAIL>".
# Args: <label> <yaml-path>
time_step() {
  local label="$1" yaml="$2"
  local t0 t1 ms rc
  t0=$(now_ns)
  run_maestro "$yaml"; rc=$?
  t1=$(now_ns)
  ms=$(( (t1 - t0) / 1000000 ))
  local status=OK
  [ $rc -ne 0 ] && status=FAIL
  printf "%-22s  %6d ms  %s\n" "$label" "$ms" "$status"
}
