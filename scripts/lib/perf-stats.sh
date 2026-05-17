#!/usr/bin/env bash
# Shared perf helpers for scripts/perf-*.sh.
#
# Source from a perf script:
#   source "$(dirname "$0")/lib/perf-stats.sh"
#
# Then call:
#   perf_stats_report <name> "${samples[@]}"
#   perf_gfxinfo_reset <device> <pkg>
#   perf_gfxinfo_sample <device> <pkg>          # prints jank metrics
#   perf_perfetto_start <device> <out_local>    # if PERFETTO=1 in env
#   perf_perfetto_stop <device> <out_local>
#
# Style: bash 4 features (associative arrays, sort -n), no external deps
# beyond adb, awk, sort, sed.

set -u  # callers usually -euo pipefail; we don't redo that here.

# ---------- percentile + stats ------------------------------------------
#
# perf_stats_report <label> <ms_1> <ms_2> ... <ms_N>
#
# Prints a one-block summary with min / p50 / p95 / p99 / max / mean +
# the underlying samples. Avoids `bc` so it stays portable on minimal
# CI images.
perf_stats_report() {
  local label="$1"; shift
  local -a samples=("$@")
  local n="${#samples[@]}"
  if (( n == 0 )); then
    printf '%s: no samples\n' "$label"
    return
  fi
  # Sort numerically into a new array.
  local -a sorted
  IFS=$'\n' read -r -d '' -a sorted < <(printf '%s\n' "${samples[@]}" | sort -n && printf '\0')
  local min="${sorted[0]}"
  local max="${sorted[n-1]}"
  # Index via nearest-rank — p99 of 3 samples is just max.
  local idx50 idx95 idx99
  idx50=$(( (50 * n + 99) / 100 - 1 )); (( idx50 < 0 )) && idx50=0
  idx95=$(( (95 * n + 99) / 100 - 1 )); (( idx95 < 0 )) && idx95=0
  idx99=$(( (99 * n + 99) / 100 - 1 )); (( idx99 < 0 )) && idx99=0
  local p50="${sorted[idx50]}"
  local p95="${sorted[idx95]}"
  local p99="${sorted[idx99]}"
  # Integer mean via awk so we don't pull in bc.
  local mean
  mean=$(printf '%s\n' "${samples[@]}" | awk '{s+=$1} END {printf "%d", s/NR}')
  printf '\n%s (n=%d):\n' "$label" "$n"
  printf '  min  %6d ms\n' "$min"
  printf '  p50  %6d ms\n' "$p50"
  printf '  p95  %6d ms\n' "$p95"
  printf '  p99  %6d ms\n' "$p99"
  printf '  max  %6d ms\n' "$max"
  printf '  mean %6d ms\n' "$mean"
}

# ---------- gfxinfo (frame jank) ---------------------------------------
#
# `dumpsys gfxinfo <pkg> reset` zeros the framestats counter.
# After the action under test, `dumpsys gfxinfo <pkg>` returns a block
# that includes:
#   Total frames rendered: NN
#   Janky frames: NN (PP.PP%)
#   50th percentile: NNms
#   95th percentile: NNms
#   99th percentile: NNms
# We grep those out.
perf_gfxinfo_reset() {
  local device="$1" pkg="$2"
  adb -s "$device" shell dumpsys gfxinfo "$pkg" reset > /dev/null 2>&1 || true
}

# Print a labelled, one-line summary of the gfxinfo block, e.g.
#   gfxinfo: total=387 janky=12 (3.1%) p50=8ms p95=15ms p99=24ms
perf_gfxinfo_sample() {
  local device="$1" pkg="$2"
  local dump
  dump=$(adb -s "$device" shell dumpsys gfxinfo "$pkg" 2>/dev/null || true)
  if [ -z "$dump" ]; then
    printf 'gfxinfo: (no data — package not running?)\n'
    return
  fi
  local total janky pct p50 p95 p99
  total=$(printf '%s\n' "$dump" | awk -F': *' '/Total frames rendered/ {print $2; exit}')
  janky=$(printf '%s\n' "$dump" | awk '/Janky frames/ {print $3; exit}')
  pct=$(printf   '%s\n' "$dump" | awk '/Janky frames/ {gsub(/[()%]/, "", $4); print $4; exit}')
  p50=$(printf   '%s\n' "$dump" | awk -F': *' '/50th percentile/ {print $2; exit}')
  p95=$(printf   '%s\n' "$dump" | awk -F': *' '/95th percentile/ {print $2; exit}')
  p99=$(printf   '%s\n' "$dump" | awk -F': *' '/99th percentile/ {print $2; exit}')
  printf 'gfxinfo: total=%s janky=%s (%s%%) p50=%s p95=%s p99=%s\n' \
    "${total:-?}" "${janky:-?}" "${pct:-?}" "${p50:-?}" "${p95:-?}" "${p99:-?}"
}

# ---------- Perfetto (full trace, optional) ----------------------------
#
# Captures a system trace covering scheduler / gfx / app atrace events.
# Enabled when `PERFETTO=1` is set in the env. The script writes a
# pre-baked config + starts perfetto via nohup so it survives the
# adb-shell exit, then `perf_perfetto_stop` pulls the .pftrace ready
# for perfetto.dev.
#
# Why this exists: bare `adb shell perfetto -c <cfg> -o <out>` is
# extremely fiddly — config-from-stdin loses bytes, default trace
# durations are too short, and the trace file gets stuck in
# /data/local/tmp with no easy way to know if the daemon's done. This
# wrapper smooths those edges.

PERFETTO_DEVICE_CFG=/data/local/tmp/lp-perfetto-config.txt
PERFETTO_DEVICE_OUT=/data/local/tmp/lp-perfetto-trace.pftrace
PERFETTO_DEVICE_LOG=/data/local/tmp/lp-perfetto.log

# Generate the config locally then push it.
# Caller sets duration_ms via the second arg (default 30s).
_perf_perfetto_write_config() {
  local device="$1" duration_ms="${2:-30000}" pkg="${3:-com.lightningpiggy.app.dev}"
  local cfg
  cfg="$(cat <<EOF
buffers: {
  size_kb: 131072
  fill_policy: DISCARD
}
data_sources {
  config {
    name: "linux.process_stats"
    target_buffer: 0
    process_stats_config { scan_all_processes_on_start: true proc_stats_poll_ms: 1000 }
  }
}
data_sources {
  config {
    name: "linux.ftrace"
    ftrace_config {
      ftrace_events: "sched/sched_switch"
      ftrace_events: "sched/sched_wakeup"
      ftrace_events: "sched/sched_wakeup_new"
      ftrace_events: "sched/sched_process_exit"
      atrace_categories: "view"
      atrace_categories: "input"
      atrace_categories: "gfx"
      atrace_categories: "am"
      atrace_categories: "wm"
      atrace_categories: "binder_driver"
      atrace_apps: "$pkg"
    }
  }
}
duration_ms: $duration_ms
EOF
)"
  # Push via a local temp file — heredoc-through-adb-shell drops bytes.
  local local_tmp; local_tmp=$(mktemp)
  printf '%s\n' "$cfg" > "$local_tmp"
  adb -s "$device" push "$local_tmp" "$PERFETTO_DEVICE_CFG" > /dev/null 2>&1
  rm -f "$local_tmp"
}

perf_perfetto_start() {
  local device="$1" duration_ms="${2:-30000}" pkg="${3:-com.lightningpiggy.app.dev}"
  [ "${PERFETTO:-0}" = "1" ] || return 0
  _perf_perfetto_write_config "$device" "$duration_ms" "$pkg"
  adb -s "$device" shell "rm -f $PERFETTO_DEVICE_OUT $PERFETTO_DEVICE_LOG" > /dev/null 2>&1
  # nohup + & inside adb shell so the daemon survives shell exit.
  adb -s "$device" shell "nohup perfetto --txt -c $PERFETTO_DEVICE_CFG -o $PERFETTO_DEVICE_OUT > $PERFETTO_DEVICE_LOG 2>&1 &" > /dev/null 2>&1
  printf 'perfetto: started (%dms window)\n' "$duration_ms"
}

# Polls until perfetto has exited, then pulls the trace file.
perf_perfetto_stop() {
  local device="$1" out_local="$2"
  [ "${PERFETTO:-0}" = "1" ] || return 0
  # Give the daemon up to 60s to finish its own duration_ms window.
  local waited=0
  while (( waited < 60 )); do
    if ! adb -s "$device" shell pgrep -f perfetto > /dev/null 2>&1; then break; fi
    sleep 2
    waited=$(( waited + 2 ))
  done
  if adb -s "$device" pull "$PERFETTO_DEVICE_OUT" "$out_local" > /dev/null 2>&1; then
    printf 'perfetto: pulled to %s — open at https://ui.perfetto.dev (drag-drop the file)\n' "$out_local"
  else
    printf 'perfetto: trace file missing — check %s on device\n' "$PERFETTO_DEVICE_LOG"
  fi
}
