#!/usr/bin/env bash
# Signer-matrix E2E runner: the same app exercised with all three Nostr signers
#   Big Piggy    → nsec (local key)
#   Middle Piggy → Amber (NIP-55) on the device
#   Little Piggy → NIP-46 via the local test bunker (scripts/nip46-test-bunker.sh)
#
#   bash scripts/signer-matrix-e2e.sh              # 132 133 134 (smoke, Marmot+Amber, NIP-46 DM)
#   bash scripts/signer-matrix-e2e.sh 134 135      # a subset (135 = slow pairing timeout)
#   bash scripts/signer-matrix-e2e.sh setup-amber  # flow-131: import Middle's key into a fresh Amber
#
# Env: DEVICE (default emulator-5554 — emulators only unless
# SIGNER_MATRIX_ALLOW_DEVICE=1), OUT (artifacts dir, default a fresh mktemp),
# LOCK_FILE (optional: hold this flock for the whole run — for shared
# emulators), RUN_TAG (default: unique per run).
#
# Secrets: only the three Piggy nsecs are read from .env and exported (as
# MAESTRO_NSEC_*, which Maestro picks up itself — never on argv); nothing else
# in .env reaches Maestro, adb or the bunker. Maestro's debug output records
# evaluated commands — including typed nsecs — so it goes to a private temp dir
# and is redacted before being kept with the artifacts.
#
# With LOCK_FILE set, the lock is held for the whole run (preparation, every
# flow, restore and cleanup), not per command.
set -uo pipefail
cd "$(dirname "$0")/.."
for v in MAESTRO_NSEC_BIG MAESTRO_NSEC_MIDDLE MAESTRO_NSEC_LITTLE; do
  val="$(grep -E "^$v=" .env | tail -1 | cut -d= -f2- | tr -d "\"' \r")"
  [[ "$val" == nsec1* ]] || { echo "$v missing from .env" >&2; exit 2; }
  export "$v=$val"
done
unset val
export PATH="$PATH:$HOME/.maestro/bin"
DEVICE="${DEVICE:-emulator-5554}"
if [[ "$DEVICE" != emulator-* && "${SIGNER_MATRIX_ALLOW_DEVICE:-}" != 1 ]]; then
  echo "refusing to drive $DEVICE (not an emulator); set SIGNER_MATRIX_ALLOW_DEVICE=1 to override" >&2
  exit 2
fi
FLOWS=("$@"); [ ${#FLOWS[@]} -eq 0 ] && FLOWS=(132 133 134)
if [ -n "${LOCK_FILE:-}" ]; then
  # Fail closed: never drive a shared emulator without the lock.
  exec 9>>"$LOCK_FILE" || { echo "cannot open $LOCK_FILE" >&2; exit 2; }
  echo "waiting for $LOCK_FILE…"
  flock 9 || { echo "could not lock $LOCK_FILE" >&2; exit 2; }
fi
OUT="${OUT:-$(mktemp -d /tmp/signer-matrix.XXXX)}"; mkdir -p "$OUT"
DBG="$(mktemp -d)"; chmod 700 "$DBG"
export RUN_TAG="${RUN_TAG:-sm$(date +%m%d%H%M%S)}"
fail=0
started_bunker=0
bunker_used=0

restore_device() { # best effort: Big active, Middle/Little out, bunker back to approve
  [ $bunker_used -eq 1 ] && bash scripts/nip46-test-bunker.sh mode approve >/dev/null 2>&1
  adb -s "$DEVICE" shell am force-stop com.greenart7c3.nostrsigner
  (cd "$OUT" && maestro --device "$DEVICE" test --debug-output "$DBG/restore" \
    "$OLDPWD/.maestro/common/restore-signer-matrix.yaml") >"$OUT/restore.out" 2>&1 \
    && echo "   restored: Big Piggy active" || echo "   !! restore failed — see $OUT/restore.out"
}

cleanup() {
  # Redact what Maestro wrote into its debug output (typed nsecs, the bunker
  # token from its env dump) and drop its automatic screenshots from NIP-46
  # flows — one could show LP's pairing QR, which carries the pairing secret.
  if [ -d "$DBG" ]; then
    grep -rlZ 'nsec1' "$DBG" 2>/dev/null | xargs -0r sed -i -E 's/nsec1[0-9a-z]+/nsec1[redacted]/g'
    if [ -n "${MAESTRO_NIP46_TOKEN:-}" ]; then
      grep -rlZF "$MAESTRO_NIP46_TOKEN" "$DBG" 2>/dev/null | xargs -0r sed -i "s/$MAESTRO_NIP46_TOKEN/[redacted]/g"
    fi
    find "$DBG" \( -path '*flow-132*' -o -path '*flow-134*' -o -path '*flow-135*' -o -path '*/restore*' \) \
      -name '*.png' -delete 2>/dev/null
    if grep -rqE 'nsec1[0-9a-z]{20,}' "$DBG" 2>/dev/null; then
      echo "!! redaction failed — debug output NOT kept" >&2; rm -rf "$DBG"
    fi
    mkdir -p "$OUT/debug" && cp -r "$DBG"/. "$OUT/debug/" 2>/dev/null
    rm -rf "$DBG"
  fi
  [ $started_bunker -eq 1 ] && bash scripts/nip46-test-bunker.sh stop >/dev/null
}
trap cleanup EXIT


need_amber() {
  adb -s "$DEVICE" shell pm list packages | grep -q com.greenart7c3.nostrsigner \
    || { echo "!! Amber is not installed on $DEVICE — see docs/TESTING.adoc → Signer matrix"; return 1; }
}
need_bunker() {
  if ! bash scripts/nip46-test-bunker.sh status >/dev/null 2>&1; then
    NIP46_DEVICE="$DEVICE" bash scripts/nip46-test-bunker.sh start >/dev/null || return 1
    started_bunker=1
  fi
  # A bunker started earlier for another device would screencap the wrong one.
  bash scripts/nip46-test-bunker.sh status | grep -q "\"device\":\"$DEVICE\"" \
    || { echo "!! running bunker is bound to another device — stop it first"; return 1; }
  bunker_used=1
  MAESTRO_NIP46_TOKEN="$(cat "$(bash scripts/nip46-test-bunker.sh token-file)")"
  export MAESTRO_NIP46_TOKEN MAESTRO_NIP46_PORT="${NIP46_PORT:-8746}"
}

run_flow() { # path
  local name; name="$(basename "$1" .yaml)"
  echo "== $name (RUN_TAG=$RUN_TAG)"
  mkdir -p "$OUT/$name"
  # Fresh launch per flow (state is kept — this only restarts the JS app), so
  # a red box / stuck sheet from an earlier flow can't leak into this one.
  adb -s "$DEVICE" shell am force-stop "${APP_ID:-com.lightningpiggy.app.dev}"
  # A prompt left open by an earlier flow outlives LP; Amber's keys persist.
  adb -s "$DEVICE" shell am force-stop com.greenart7c3.nostrsigner
  if (cd "$OUT/$name" && maestro --device "$DEVICE" test \
      --debug-output "$DBG/$name" -e RUN_TAG="$RUN_TAG" "$OLDPWD/$1") >"$OUT/$name/maestro.out" 2>&1; then
    echo "   ✓ passed"
  else
    echo "   ✗ FAILED — $(grep -m1 -E 'FAILED|Element not found|Assertion' "$OUT/$name/maestro.out")"
    fail=1
    # The flow's own restore steps were skipped — put the device back.
    restore_device
  fi
  # Prompt-storm signal: how many Amber prompts the flow had to answer.
  local log; log="$(find "$DBG/$name" -name maestro.log 2>/dev/null | head -1)"
  if [ -n "$log" ]; then
    echo "   Amber prompts answered: connect=$(grep -c 'Tap on "Connect" COMPLETED' "$log")" \
      "accept=$(grep -c 'Tap on "Accept" COMPLETED' "$log") batch-approve=$(grep -c 'Tap on "Approve" COMPLETED' "$log") reject=$(grep -cE 'Tap on "(Reject|Deny)" COMPLETED' "$log")"
  fi
}

for f in "${FLOWS[@]}"; do
  case $f in
    setup-amber|131) need_amber && run_flow .maestro/authentication/flow-131-amber-import-middle.yaml || fail=1 ;;
    132) { need_amber && need_bunker; } && run_flow .maestro/authentication/flow-132-signer-matrix-smoke.yaml || fail=1 ;;
    133) need_amber && run_flow .maestro/messaging/flow-133-marmot-big-nsec-middle-amber.yaml || fail=1 ;;
    134) need_bunker && run_flow .maestro/messaging/flow-134-nip17-dm-nip46-approve-decline-timeout.yaml || fail=1 ;;
    135) need_bunker && run_flow .maestro/authentication/flow-135-nip46-pairing-timeout.yaml || fail=1 ;;
    *) echo "unknown flow $f"; fail=1 ;;
  esac
done

if [ $started_bunker -eq 1 ] || bash scripts/nip46-test-bunker.sh status >/dev/null 2>&1; then
  echo "bunker request counts: $(bash scripts/nip46-test-bunker.sh status 2>/dev/null)"
fi
echo "artifacts (screenshots, Maestro output, redacted debug): $OUT"
[ $fail -eq 0 ] && echo "SIGNER MATRIX PASSED" || echo "SIGNER MATRIX: SOME FLOWS FAILED"
exit $fail
