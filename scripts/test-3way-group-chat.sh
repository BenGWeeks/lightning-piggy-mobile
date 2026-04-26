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

run() {
  local name="$1"; shift
  echo
  echo "=== ${name} ==="
  maestro --device "${DEVICE}" test \
    -e "MAESTRO_NSEC=${MAESTRO_NSEC}" \
    -e "MAESTRO_NSEC2=${MAESTRO_NSEC2}" \
    -e "MAESTRO_NSEC3=${MAESTRO_NSEC3}" \
    "$@"
}

run "Phase 1 — Big creates Triad" tests/e2e/test-3way-group-create-as-big.yaml
run "Phase 2 — Middle joins"       tests/e2e/test-3way-group-as-middle.yaml
run "Phase 3 — Little joins"       tests/e2e/test-3way-group-as-little.yaml
run "Phase 4 — Big renames"        tests/e2e/test-3way-group-rename-as-big.yaml
run "Phase 5 — Middle sees rename" tests/e2e/test-3way-group-rename-confirm-as-middle.yaml

echo
echo "All 3-way group-chat phases passed."
