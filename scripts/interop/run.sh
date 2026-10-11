#!/usr/bin/env bash
# Scripted Marmot interop run: Lightning Piggy ↔ White Noise (+ the scripted
# sender as a third member). One run covers the matrix in minutes:
#
#   1. marmot-sender.mjs (a test Piggy on its own MLS device, no UI) creates a
#      fresh group "IO <tag>" with Big Piggy's Lightning Piggy installs and
#      Little Piggy's White Noise, sends the item set, and opens a Marmot 1:1
#      with Big for the reply/reaction subset.               (no device lock)
#   2. Maestro: Lightning Piggy asserts every item (group + 1:1), White Noise
#      asserts every item, Lightning Piggy sends its own items. (device lock)
#   3. The sender checks Lightning Piggy's items arrived on the wire, then
#      makes Big an admin and says "after-admins".            (no device lock)
#   4. Maestro: Lightning Piggy sees it, renames the group, sends again (#1309
#      path); the sender says "after-rename"; White Noise and Lightning Piggy
#      assert the post-change messages.                       (device lock)
#   5. Writes matrix.md + screenshots + raw logs to $OUT.
#
#   bash scripts/interop/run.sh
#
# Env (all optional):
#   DEVICE=emulator-5554        adb serial with Lightning Piggy (as Big Piggy) AND
#                               White Noise (as Little Piggy) installed.
#   SENDER=MIDDLE               which MAESTRO_NSEC_<SENDER> from .env the sender uses.
#   METRO_PORT=<port>           point the dev client at this Metro for the run
#                               (restored to 8090 afterwards). Unset = leave as is.
#   LOCK_DIR=/tmp/claude-$UID   where the lane locks live (emulator.lock, maestro.lock).
#   OUT=~/lp-interop-runs/<date>-<tag>
#   SKIP_WN=1                   Lightning Piggy only (no White Noise flows).
#
# Never pays anything (the invoice item is an expired test invoice) and only
# ever talks to the three Piggy test accounts.
set -uo pipefail
cd "$(dirname "$0")/../.."
REPO=$PWD
set -a; source .env; set +a
export PATH="$PATH:$HOME/.maestro/bin"

DEVICE="${DEVICE:-emulator-5554}"
SENDER="${SENDER:-MIDDLE}"
LOCK_DIR="${LOCK_DIR:-/tmp/claude-$(id -u)}"
TAG="$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 4)"
OUT="${OUT:-$HOME/lp-interop-runs/$(date +%Y-%m-%d-%H%M)-$TAG}"
mkdir -p "$OUT/screenshots" "$OUT/logs"
STATE="$OUT/logs/sender-group.json"
DM_STATE="$OUT/logs/sender-dm.json"
FLOWS="$REPO/.maestro/interop"
NSEC_VAR="MAESTRO_NSEC_$SENDER"
export INTEROP_NSEC="${!NSEC_VAR:?set $NSEC_VAR in .env}"

hexpub() { node --input-type=module -e "import {nip19,getPublicKey} from 'nostr-tools'; console.log(getPublicKey(nip19.decode(process.env.K).data))"; }
BIG_HEX="$(K="$MAESTRO_NSEC_BIG" hexpub)"
LITTLE_HEX="$(K="$MAESTRO_NSEC_LITTLE" hexpub)"
SENDER_HEX="$(K="$INTEROP_NSEC" hexpub)"
redact() { sed -E 's/nsec1[0-9a-z]+/[redacted]/g'; }
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT/logs/run.log"; }
sender() { node scripts/interop/marmot-sender.mjs "$@" 2>>"$OUT/logs/sender.err" | redact; }

# --- device helpers (only ever called under the device lock) --------------
is_emulator() { [[ "$DEVICE" == emulator-* ]]; }
metro_host() { if is_emulator; then echo "10.0.2.2:$1"; else echo "localhost:$1"; fi; }
set_metro() {
  is_emulator || adb -s "$DEVICE" reverse "tcp:$1" "tcp:$1" >/dev/null
  adb -s "$DEVICE" shell "run-as com.lightningpiggy.app.dev sh -c 'printf \"%s\\n\" \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?>\" \"<map>\" \"    <string name=\\\"debug_http_host\\\">$(metro_host "$1")</string>\" \"</map>\" > shared_prefs/com.lightningpiggy.app.dev_preferences.xml'"
  adb -s "$DEVICE" shell am force-stop com.lightningpiggy.app.dev
}
FIXTURE_ON_DEVICE=/sdcard/Pictures/interop-image.png
device_setup() {
  [ -n "${METRO_PORT:-}" ] && set_metro "$METRO_PORT"
  adb -s "$DEVICE" push "$FLOWS/fixtures/interop-image.png" "$FIXTURE_ON_DEVICE" >/dev/null
  adb -s "$DEVICE" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
    -d "file://$FIXTURE_ON_DEVICE" >/dev/null
}
device_restore() {
  [ -n "${METRO_PORT:-}" ] && set_metro 8090
  adb -s "$DEVICE" shell rm -f "$FIXTURE_ON_DEVICE" >/dev/null 2>&1
  adb -s "$DEVICE" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
    -d "file://$FIXTURE_ON_DEVICE" >/dev/null 2>&1
}
flow() { # file [KEY=VALUE ...] — one Maestro run under maestro.lock
  local f=$1; shift
  local args=(-e TAG="$TAG")
  for kv in "$@"; do args+=(-e "$kv"); done
  say "maestro $(basename "$f")"
  (cd "$OUT/screenshots" && flock -w 3600 "$LOCK_DIR/maestro.lock" \
    maestro --device "$DEVICE" test "${args[@]}" "$f") 2>&1 | redact >"$OUT/logs/$(basename "$f" .yaml).log"
}
export -f flow say redact set_metro metro_host is_emulator device_setup device_restore
export DEVICE OUT TAG LOCK_DIR FIXTURE_ON_DEVICE FLOWS METRO_PORT

# Run "$@" under the device lock, with setup + restore inside the lock.
with_device() {
  flock -w 3600 "$LOCK_DIR/emulator.lock" bash -c '
    trap device_restore EXIT
    device_setup
    '"$*"
}

# --- 1. scripted sender: group + 1:1 ----------------------------------------
say "run tag $TAG → $OUT"
say "sender $SENDER (${SENDER_HEX:0:8}) creates group 'IO $TAG' with Big (LP) + Little (WN)"
invite="$BIG_HEX@Lightning Piggy"
[ -z "${SKIP_WN:-}" ] && invite="$invite,$LITTLE_HEX@White Noise"
sender create --state "$STATE" --name "IO $TAG" --invite "$invite" | tee "$OUT/logs/create.json" >/dev/null
GROUP_ID="$(jq -r '.groupId // empty' "$STATE" 2>/dev/null)"
[ -n "$GROUP_ID" ] || { say "group creation failed — see logs/sender.err"; exit 1; }
sender send --state "$STATE" --tag "$TAG" >"$OUT/logs/send-group.jsonl"
say "sent $(grep -c '"ok":true' "$OUT/logs/send-group.jsonl") / $(wc -l <"$OUT/logs/send-group.jsonl") items into the group"
sender create --state "$DM_STATE" --dm --invite "$BIG_HEX@Lightning Piggy" >"$OUT/logs/create-dm.json"
sender send --state "$DM_STATE" --tag "$TAG" \
  --only text.plain,text.zh,text.emoji,reply,react,react2,unreact,edit.target,edit,delete.target,delete \
  >"$OUT/logs/send-dm.jsonl"

# --- 2. receive checks + Lightning Piggy sends --------------------------------
ROW="group-row-marmot:$GROUP_ID"
DM_ROW="conversation-row-$SENDER_HEX:marmot"
with_device "
  flow '$FLOWS/flow-145-interop-lp-receives-group.yaml' ROW_ID='$ROW'
  flow '$FLOWS/flow-151-interop-lp-receives-dm.yaml' ROW_ID='$DM_ROW'
  [ -z '${SKIP_WN:-}' ] && flow '$FLOWS/flow-146-interop-wn-receives-group.yaml' WN_CHAT='IO $TAG'
  flow '$FLOWS/flow-147-interop-lp-sends-group.yaml' ROW_ID='$ROW'
"

# --- 3. wire check of Lightning Piggy's items, then an admin change ---------
sender listen --state "$STATE" --seconds 90 \
  --expect "IO${TAG}L plain" --expect "IO${TAG}L md" --expect "IO${TAG}L long" \
  --expect "IO${TAG}L editme v1 EDITED" >"$OUT/logs/listen-lp.jsonl"
sender admins --state "$STATE" --set "$SENDER_HEX,$BIG_HEX" >"$OUT/logs/admins.json"
sender say --state "$STATE" --text "IO$TAG after-admins" >>"$OUT/logs/admins.json"

# --- 4. rename by Lightning Piggy (#1309 path) + post-change checks ---------
with_device "flow '$FLOWS/flow-149-interop-lp-rename-after-admin.yaml' ROW_ID='$ROW'"
sender say --state "$STATE" --text "IO$TAG after-rename" >"$OUT/logs/after-rename.json"
sender info --state "$STATE" >"$OUT/logs/group-info.json"
with_device "
  flow '$FLOWS/flow-150-interop-lp-receives-after-rename.yaml' ROW_ID='$ROW'
  [ -z '${SKIP_WN:-}' ] && flow '$FLOWS/flow-148-interop-wn-receives-lp.yaml' WN_CHAT='IO $TAG'
"

# --- 5. matrix ------------------------------------------------------------
node scripts/interop/matrix.mjs "$OUT" "$TAG" >"$OUT/matrix.md"
say "done → $OUT/matrix.md"
grep -E '^\| (PASS|FAIL)' -c "$OUT/matrix.md" >/dev/null 2>&1
cat "$OUT/matrix.md" | head -60
