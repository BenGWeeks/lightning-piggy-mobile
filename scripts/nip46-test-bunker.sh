#!/usr/bin/env bash
# Local NIP-46 test bunker for the signer-matrix E2E flows (Little Piggy by
# default). Wraps scripts/nip46-test-bunker.mjs — see that file for the
# protocol details and the HTTP control API the Maestro flows use.
#
#   bash scripts/nip46-test-bunker.sh start             # daemon, mode=approve
#   bash scripts/nip46-test-bunker.sh mode decline      # approve|decline|silent|decline-all|silent-all
#   bash scripts/nip46-test-bunker.sh pair-from-screen  # decode LP's pairing QR on $NIP46_DEVICE and ack it
#   bash scripts/nip46-test-bunker.sh pair < uri.txt    # ack a nostrconnect:// URI read from stdin
#   bash scripts/nip46-test-bunker.sh status            # mode + per-method request counts (JSON)
#   bash scripts/nip46-test-bunker.sh log               # tail the daemon log
#   bash scripts/nip46-test-bunker.sh stop
#
# Env:
#   NIP46_PIGGY   BIG | MIDDLE | LITTLE (default LITTLE) — which MAESTRO_NSEC_<PIGGY>
#                 from .env the bunker holds. Only Piggy fixtures are accepted.
#   NIP46_DEVICE  adb serial for pair-from-screen (default emulator-5554)
#   NIP46_PORT    control port on 127.0.0.1 (default 8746)
#   NIP46_RELAYS  comma-separated relays (default wss://relay.nsec.app — the
#                 relay LP's NostrLoginSheet pairs over)
#
# Secret handling: the nsec is read from .env by grep (the rest of .env is not
# sourced) and handed to node on stdin — node runs with an allowlisted
# environment (env -i), so it never appears in argv, the process environment,
# the state dir or the log. The control API needs the random per-start token
# in $STATE_DIR/token; this script sends it (and any pairing URI) to curl via
# files/stdin, never argv.
set -euo pipefail
cd "$(dirname "$0")/.."

PIGGY="${NIP46_PIGGY:-LITTLE}"
PORT="${NIP46_PORT:-8746}"
DEVICE="${NIP46_DEVICE:-emulator-5554}"
STATE_DIR="${NIP46_STATE_DIR:-${XDG_RUNTIME_DIR:-/tmp}/lp-nip46-bunker-$(id -u)}"
PID_FILE="$STATE_DIR/bunker.pid"
LOG_FILE="$STATE_DIR/bunker.log"
URL="http://127.0.0.1:$PORT"

die() { echo "nip46-test-bunker: $*" >&2; exit 1; }
running() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }
secure_state_dir() { # private, owned by us, not a symlink
  umask 077
  [ -L "$STATE_DIR" ] && die "$STATE_DIR is a symlink — refusing"
  mkdir -p "$STATE_DIR"
  [ "$(stat -c %u "$STATE_DIR")" = "$(id -u)" ] || die "$STATE_DIR is not owned by $(id -un)"
  chmod 700 "$STATE_DIR"
  [ -L "$LOG_FILE" ] && die "$LOG_FILE is a symlink — refusing"
  touch "$LOG_FILE" && chmod 600 "$LOG_FILE"
}
api() { # method path — request body (if any) on stdin
  [ -f "$STATE_DIR/token" ] || die "no control token (is the bunker running? $0 start)"
  local hdr; hdr="$(mktemp "$STATE_DIR/hdr.XXXXXX")"
  printf 'Authorization: Bearer %s\n' "$(cat "$STATE_DIR/token")" >"$hdr"
  local rc=0
  if [ "$1" = GET ]; then
    curl -fsS --max-time "${API_TIMEOUT:-40}" -H "@$hdr" "$URL$2" || rc=$?
  else
    curl -fsS --max-time "${API_TIMEOUT:-40}" -H "@$hdr" -X "$1" --data-binary @- "$URL$2" || rc=$?
  fi
  rm -f "$hdr"
  [ $rc -eq 0 ] || die "control API $1 $2 failed (is the bunker running? see: $0 log)"
  echo
}

case "${1:-}" in
  start)
    case "$PIGGY" in BIG | MIDDLE | LITTLE) ;; *) die "NIP46_PIGGY must be BIG, MIDDLE or LITTLE" ;; esac
    running && { echo "already running (pid $(cat "$PID_FILE"))"; exit 0; }
    [ -f .env ] || die ".env not found (needs MAESTRO_NSEC_$PIGGY)"
    secure_state_dir
    # Strip optional quotes; never echo the value.
    nsec="$(grep -E "^MAESTRO_NSEC_${PIGGY}=" .env | tail -1 | cut -d= -f2- | tr -d "\"' \r")"
    [[ "$nsec" == nsec1* ]] || die "MAESTRO_NSEC_$PIGGY missing or not an nsec in .env"
    # setsid + nohup: survive the calling shell / Maestro run ending.
    rm -f "$STATE_DIR/token"
    env -i PATH="$PATH" HOME="$HOME" \
      NIP46_STATE_DIR="$STATE_DIR" NIP46_PORT="$PORT" NIP46_DEVICE="$DEVICE" \
      NIP46_RELAYS="${NIP46_RELAYS:-wss://relay.nsec.app}" \
      setsid nohup node scripts/nip46-test-bunker.mjs >>"$LOG_FILE" 2>&1 < <(printf '%s\n' "$nsec") &
    echo $! >"$PID_FILE"
    unset nsec
    for _ in $(seq 1 40); do
      [ -f "$STATE_DIR/token" ] && ( api GET /status ) >/dev/null 2>&1 && { echo "started (pid $(cat "$PID_FILE"), $URL)"; api GET /status; exit 0; }
      running || break
      sleep 0.5
    done
    tail -5 "$LOG_FILE" >&2
    die "bunker did not come up"
    ;;
  stop)
    if running; then kill "$(cat "$PID_FILE")"; echo "stopped"; else echo "not running"; fi
    rm -f "$PID_FILE" "$STATE_DIR/token"
    ;;
  mode)
    [ -n "${2:-}" ] || die "usage: $0 mode approve|decline|silent|decline-all|silent-all"
    printf '%s' "$2" | api POST /mode
    ;;
  pair)
    # URI on stdin only — it carries the pairing secret, so never an argument.
    api POST /pair
    ;;
  pair-from-screen)
    printf '%s' "${2:-20}" | API_TIMEOUT=$((${2:-20} + 30)) api POST /pair-from-screen
    ;;
  status) api GET /status ;;
  reset-stats) api POST /stats/reset </dev/null ;;
  token-file) echo "$STATE_DIR/token" ;;
  log) tail -n "${2:-40}" "$LOG_FILE" ;;
  *)
    sed -n '2,25p' "$0"
    exit 1
    ;;
esac
