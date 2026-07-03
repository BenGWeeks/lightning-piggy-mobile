#!/usr/bin/env bash
# Run the FoF compute-path microbenchmark. Wraps Jest with the right
# --testRegex so the .bench.ts file (NOT picked up by default testMatch)
# executes. Prints the median + p95 wall-clock numbers from the bench's
# own console.log block.
#
# Usage:
#   bash scripts/bench-fof.sh
#
# See: src/services/friendsOfFriendsService.bench.ts
set -euo pipefail

cd "$(dirname "$0")/.."
exec npx jest \
  --testMatch '**/friendsOfFriendsService.bench.ts' \
  --testPathIgnorePatterns=[] \
  --verbose
