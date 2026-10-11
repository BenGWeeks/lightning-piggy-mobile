#!/usr/bin/env bash
# Compare two Jest json-summary files and fail if line coverage dropped by more
# than the noise floor. Used by .github/workflows/coverage.yml.
#
# Usage: compare-coverage.sh <pr-summary.json> <baseline-summary.json> [noise-floor-pp]
#
# A missing file or a non-numeric pct ("Unknown" when no tests ran) counts as 0%,
# matching the behaviour the workflow had before the baseline was cached.
# Appends a markdown table to $GITHUB_STEP_SUMMARY when that variable is set.
set -euo pipefail

PR_FILE="${1:?usage: compare-coverage.sh <pr-summary.json> <baseline-summary.json> [noise-floor]}"
BASE_FILE="${2:?usage: compare-coverage.sh <pr-summary.json> <baseline-summary.json> [noise-floor]}"
NOISE_FLOOR="${3:-0.5}"

read_pct() {
  if [[ ! -f "$1" ]]; then
    echo 0
    return
  fi
  node -e "const p=require(require('path').resolve(process.argv[1])).total.lines.pct; console.log(typeof p === 'number' ? p : 0)" "$1"
}

PR_PCT=$(read_pct "$PR_FILE")
BASE_PCT=$(read_pct "$BASE_FILE")

echo "PR:   $PR_PCT%"
echo "main: $BASE_PCT%"
echo "noise floor: $NOISE_FLOOR pp"

# awk handles floats; bash arithmetic is integer-only.
DROPPED=$(awk -v pr="$PR_PCT" -v main="$BASE_PCT" -v nf="$NOISE_FLOOR" \
  'BEGIN { print (pr < main - nf) ? "yes" : "no" }')

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "| | Line coverage |"
    echo "|---|---|"
    echo "| PR | $PR_PCT% |"
    echo "| main baseline | $BASE_PCT% |"
    echo "| allowed drop | $NOISE_FLOOR pp |"
  } >>"$GITHUB_STEP_SUMMARY"
fi

if [[ "$DROPPED" == "yes" ]]; then
  echo "::error::Coverage regressed: $PR_PCT% < $BASE_PCT% - $NOISE_FLOOR pp"
  echo "Add unit tests to recover coverage. See docs/TESTING.adoc and"
  echo "scripts/coverage-priorities.sh for help picking what to cover."
  exit 1
fi

echo "Coverage gate passed."
