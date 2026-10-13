#!/usr/bin/env bash
# Mutation/persistence checks: run only on an explicitly chosen dedicated test device.
# Usage: bash .maestro/reporting/run-settings-regression.sh <adb-serial>
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo 'Usage: run-settings-regression.sh <dedicated-test-device-serial>' >&2
  exit 2
fi

cd "$(dirname "$0")/../.."
for flow in \
  profile/flow-095-appearance-theme.yaml \
  profile/flow-118-appearance-sending-animation.yaml; do
  maestro --device "$1" test -e EXERCISE_SETTINGS=true ".maestro/$flow"
done

# Select English on the dedicated test device; an empty SHOT disables screenshots.
maestro --device "$1" test -e EXERCISE_SETTINGS=true -e LOCALE=en -e SHOT= \
  .maestro/profile/flow-141-display-language-screens.yaml
