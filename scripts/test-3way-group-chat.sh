#!/usr/bin/env bash
# Run the 3-way Maestro group-chat suite (PR #227) end-to-end.
#
# The emulator can only host one signed-in account at a time, so the
# suite is broken into per-account flows that sign out at the end.
# Each phase is independent; failures abort the run.
#
# Pre-reqs:
#  - emulator-5554 running (or set DEVICE)
#  - .env contains MAESTRO_NSEC, MAESTRO_NSEC2, MAESTRO_NSEC3
#  - All three accounts follow each other (use scripts/add-nostr-contact.mjs
#    if needed) and Middle Piggy has a kind-0 profile.
#  - Wayland session with `wl-copy` available (Linux). The host clipboard
#    is forwarded to the emulator's clipboard, which the in-app Paste
#    button reads — see docs/TROUBLESHOOTING.adoc for why we paste
#    instead of using Maestro's `inputText` for nsec entry.
#
# Run:
#   scripts/test-3way-group-chat.sh

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi

DEVICE="${DEVICE:-emulator-5554}"

if [[ -z "${MAESTRO_NSEC:-}" || -z "${MAESTRO_NSEC2:-}" || -z "${MAESTRO_NSEC3:-}" ]]; then
  echo "Missing one of MAESTRO_NSEC / MAESTRO_NSEC2 / MAESTRO_NSEC3 in .env" >&2
  exit 1
fi

if ! command -v wl-copy >/dev/null 2>&1; then
  echo "wl-copy not found — install wl-clipboard (or adapt this script for xclip)." >&2
  exit 1
fi

# Each phase logs in as a specific piggy. The login sub-flow taps the
# in-app Paste button, which reads the device clipboard (forwarded from
# the host clipboard by the emulator's clipboard sync). Seed the right
# nsec before each `maestro test` invocation.
run() {
  local name="$1"; local nsec="$2"; shift 2
  echo
  echo "=== ${name} ==="
  # Seed the host clipboard with the phase's nsec so the in-app Paste
  # button picks it up via the emulator's clipboard-sync. All three
  # env vars are still passed through because the phase YAMLs reference
  # ${MAESTRO_NSEC2} / ${MAESTRO_NSEC3} directly when calling the sub-flow.
  printf '%s' "${nsec}" | wl-copy
  maestro --device "${DEVICE}" test \
    -e "MAESTRO_NSEC=${MAESTRO_NSEC}" \
    -e "MAESTRO_NSEC2=${MAESTRO_NSEC2}" \
    -e "MAESTRO_NSEC3=${MAESTRO_NSEC3}" \
    "$@"
}

run "Phase 1 — Big creates Triad"   "${MAESTRO_NSEC}"  tests/e2e/test-3way-group-create-as-big.yaml
run "Phase 2 — Middle joins"        "${MAESTRO_NSEC3}" tests/e2e/test-3way-group-as-middle.yaml
run "Phase 3 — Little joins"        "${MAESTRO_NSEC2}" tests/e2e/test-3way-group-as-little.yaml
run "Phase 4 — Big renames"         "${MAESTRO_NSEC}"  tests/e2e/test-3way-group-rename-as-big.yaml
run "Phase 5 — Middle sees rename"  "${MAESTRO_NSEC3}" tests/e2e/test-3way-group-rename-confirm-as-middle.yaml

echo
echo "All 3-way group-chat phases passed."
