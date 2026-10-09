#!/usr/bin/env bash
# Marmot (MLS) end-to-end runner: starts the peer bot(s), runs the Maestro
# flows against the LP emulator signed in as Big Piggy, and asserts from the
# bots' logs that the content really travelled over MLS (not NIP-17).
#
#   bash scripts/marmot-e2e.sh            # all: 125 126 127 128 129 130
#   bash scripts/marmot-e2e.sh 127 129    # a subset
#
# Needs: .env with MAESTRO_NSEC_{BIG,LITTLE,MIDDLE}; Big follows Little and
# Middle; Maestro on PATH; DEVICE (default emulator-5554).
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
DEVICE="${DEVICE:-emulator-5554}"
export PATH="$PATH:$HOME/.maestro/bin"
FLOWS=("$@"); [ ${#FLOWS[@]} -eq 0 ] && FLOWS=(125 126 127 128 129 130)
LOGDIR="$(mktemp -d /tmp/marmot-e2e.XXXX)"
# Unique per run: messages + assertions carry it, so a flow can never pass on
# bubbles left over from an earlier run.
RUN_TAG="r$(date +%H%M%S)"
BOT_PIDS=()
fail=0
prev=start

hexpub() { node --input-type=module -e "import {nip19,getPublicKey} from 'nostr-tools'; console.log(getPublicKey(nip19.decode('$1').data))"; }
BIG_HEX="$(hexpub "$MAESTRO_NSEC_BIG")"

start_bot() { # name nsec [extra env...] — log is per flow: $LOGDIR/<name>.log
  local name=$1 nsec=$2; shift 2
  env MAESTRO_NSEC_BOT="$nsec" BOT_MINUTES=20 BOT_DEBUG=1 "$@" \
    node --input-type=module < scripts/marmot-peer-bot.mjs > "$LOGDIR/$name.log" 2>&1 &
  BOT_PIDS+=($!)
  for _ in $(seq 1 30); do grep -q "key package published" "$LOGDIR/$name.log" && return 0; sleep 1; done
  echo "!! bot $name did not start"; cat "$LOGDIR/$name.log"; return 1
}
stop_bots() { for p in "${BOT_PIDS[@]}"; do kill "$p" 2>/dev/null; done; BOT_PIDS=(); }
trap stop_bots EXIT

expect_log() { # name regex description — waits up to 30 s, case-insensitive
  local i
  for i in $(seq 1 30); do grep -qiE "$2" "$LOGDIR/$1.log" && break; sleep 1; done
  if grep -qiE "$2" "$LOGDIR/$1.log"; then echo "   ✓ $1 bot: $3"; else echo "   ✗ $1 bot: $3 (missing /$2/)"; fail=1; fi
}

to_tabs() { # fresh launch, then back out of any restored conversation
  adb -s "$DEVICE" shell am force-stop com.lightningpiggy.app.dev
  adb -s "$DEVICE" shell monkey -p com.lightningpiggy.app.dev -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  for _ in $(seq 1 90); do
    adb -s "$DEVICE" exec-out uiautomator dump /dev/tty 2>/dev/null | grep -q 'tab-messages\|conversation-back' && break; sleep 2
  done
  for _ in 1 2 3 4; do
    adb -s "$DEVICE" exec-out uiautomator dump /dev/tty 2>/dev/null | grep -q 'tab-messages' && break
    adb -s "$DEVICE" shell input keyevent 4; sleep 1
  done
}

run_flow() { # file [keep-app]
  [ "${2:-}" = keep-app ] || to_tabs
  echo "== $(basename "$1")"
  if maestro --device "$DEVICE" test -e RUN_TAG="$RUN_TAG" "$1" > "$LOGDIR/$(basename "$1").out" 2>&1; then
    echo "   ✓ flow passed"
  else
    echo "   ✗ flow FAILED:"; grep -E "FAILED" "$LOGDIR/$(basename "$1").out" | head -3; fail=1
  fi
}

for f in "${FLOWS[@]}"; do
  # Fresh per-flow bot logs (kept for inspection under $LOGDIR/<flow>/).
  if [ -f "$LOGDIR/little.log" ] || [ -f "$LOGDIR/middle.log" ]; then
    mkdir -p "$LOGDIR/prev-$prev"; mv "$LOGDIR"/little.log "$LOGDIR"/middle.log "$LOGDIR/prev-$prev/" 2>/dev/null
  fi
  prev=$f
  case $f in
    125|126|127)
      # Little opens a live DM with Big if it doesn't already have one (a DM
      # made by an earlier, state-less bot is a dead end — the app prefers
      # the newest DM with a peer).
      start_bot little "$MAESTRO_NSEC_LITTLE" BOT_INITIATE_TO="$BIG_HEX" \
        BOT_INITIATE_TEXT="hi Big from Little $RUN_TAG" || { fail=1; continue; }
      run_flow ".maestro/messaging/flow-$f-"*.yaml
      case $f in
        125) expect_log little "RECV kind=9 .*over MLS $RUN_TAG" "received the DM text over MLS" ;;
        126) expect_log little "RECV kind=9 .*group over MLS $RUN_TAG" "received the group message" ;;
        127)
          expect_log little 'RECV kind=9 .*Shared contact' "contact share (kind 9)"
          expect_log little 'RECV kind=9 .*geo:' "location (kind 9)"
          expect_log little 'RECV kind=1068 ' "structured poll (kind 1068)"
          expect_log little 'MEDIA OK v=encrypted-media-v2 image/' "photo (MIP-04 v2, decrypted by the bot)"
          expect_log little 'RECV kind=9 .*lnbc' "Lightning invoice (kind 9)"
          ;;
      esac
      stop_bots ;;
    128)
      start_bot little "$MAESTRO_NSEC_LITTLE" || { fail=1; continue; }
      start_bot middle "$MAESTRO_NSEC_MIDDLE" || { fail=1; continue; }
      run_flow .maestro/messaging/flow-128-marmot-three-pigs-group.yaml
      expect_log little "RECV kind=9 .*hello three pigs $RUN_TAG" "Little got Big's group message"
      expect_log middle "RECV kind=9 .*hello three pigs $RUN_TAG" "Middle got Big's group message"
      expect_log little 'RECV kind=9 .*from=4b2fcb4e .*pong' "Little saw Middle's reply (pig ↔ pig)"
      expect_log middle 'RECV kind=9 .*from=d9b33280 .*pong' "Middle saw Little's reply (pig ↔ pig)"
      if grep -qiE "RECV kind=9 .*just two now $RUN_TAG" "$LOGDIR/middle.log"; then
        echo "   ✗ middle bot: still received after removal"; fail=1
      else echo "   ✓ middle bot: removed member no longer receives"; fi
      stop_bots ;;
    129)
      # App open on Messages first, so the fresh Welcome lands on the live sub.
      to_tabs
      maestro --device "$DEVICE" test .maestro/common/open-messages.yaml >/dev/null 2>&1
      start_bot middle "$MAESTRO_NSEC_MIDDLE" BOT_RESET=1 \
        BOT_INITIATE_TO="$BIG_HEX" BOT_INITIATE_TEXT="hello Big from Middle over MLS $RUN_TAG" || { fail=1; continue; }
      expect_log middle 'INITIATED DM' "created a fresh DM and invited Big"
      run_flow .maestro/messaging/flow-129-marmot-receive-invite.yaml keep-app
      expect_log middle "RECV kind=9 .*got your invite $RUN_TAG" "received Big's reply over MLS"
      stop_bots ;;
    130)
      # Photos both ways: the bot sends one White Noise-style; we send one
      # from the gallery (pushed here) that the bot must decrypt.
      convert -size 640x480 gradient:'#ff5c8a-#3b6cff' -gravity center -pointsize 40 -fill white \
        -annotate 0 "Photo from Little (bot)\n$RUN_TAG" "$LOGDIR/bot-photo.png"
      convert -size 640x480 gradient:'#3bd17a-#ff9f1c' -gravity center -pointsize 40 -fill white \
        -annotate 0 "Photo from Big\n$RUN_TAG" "$LOGDIR/lp-photo.jpg"
      adb -s "$DEVICE" push "$LOGDIR/lp-photo.jpg" /sdcard/Pictures/ >/dev/null
      adb -s "$DEVICE" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
        -d file:///sdcard/Pictures/lp-photo.jpg >/dev/null
      start_bot little "$MAESTRO_NSEC_LITTLE" BOT_INITIATE_TO="$BIG_HEX" \
        BOT_INITIATE_TEXT="hi Big from Little $RUN_TAG" BOT_SEND_PHOTO="$LOGDIR/bot-photo.png" || { fail=1; continue; }
      expect_log little 'SENT photo v=encrypted-media-v2' "sent a White Noise-format photo"
      run_flow .maestro/messaging/flow-130-marmot-photos.yaml
      expect_log little 'MEDIA OK v=encrypted-media-v2 image/' "decrypted our photo (MIP-04 v2)"
      stop_bots ;;
    *) echo "unknown flow $f"; fail=1 ;;
  esac
done

echo "logs: $LOGDIR"
[ $fail -eq 0 ] && echo "ALL MARMOT E2E CHECKS PASSED" || echo "SOME MARMOT E2E CHECKS FAILED"
exit $fail
