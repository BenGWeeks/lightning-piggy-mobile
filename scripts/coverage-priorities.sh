#!/usr/bin/env bash
#
# coverage-priorities.sh — rank src/** files by "where to write tests next".
#
# Heuristic
# ---------
# For each TypeScript / TSX file under src/, compute a risk score:
#
#     score = (churn * loc * fanout) / (coverage_pct + 1)
#
# where:
#   churn     = number of distinct commits touching the file in the last 90 days
#               (proxy for "code that changes a lot is more likely to regress")
#   loc       = wc -l on the file
#               (proxy for surface area — bigger files have more behaviour)
#   fanout    = count of other files in src/ that import this one
#               (proxy for blast-radius — bugs in widely-imported code hurt more)
#   coverage  = line-coverage percentage from coverage/coverage-summary.json
#               (already-tested files drop in priority; +1 avoids div-by-zero)
#
# The +1 in the denominator means a file with 0% coverage scores its full
# (churn*loc*fanout); a file with 100% coverage is divided by 101.
#
# Usage
# -----
#   # Generate coverage first (otherwise every file is treated as 0% covered):
#   npm run test:coverage
#
#   # Then rank:
#   ./scripts/coverage-priorities.sh           # top 20
#   ./scripts/coverage-priorities.sh 50        # top 50
#
# Output is a fixed-width table: rank, score, churn, loc, fanout, coverage%, path.
# (Older versions of this header said TSV; the table renderer was changed to
# fixed-width for grep / less readability.)
#
# Notes
# -----
# - Requires bash, git, awk, sort, sed. No node/npm/python needed for the
#   ranker itself.
# - Targets bash 3.2+ (macOS default) — no `mapfile`, no `<<<` here-strings
#   inside loops.
# - The fanout grep is rough — it counts source files that mention the basename.
#   Good enough as a relative ranking signal; not meant to be an exact import
#   graph. If you want a precise graph, swap in `madge` or `dependency-cruiser`.

set -euo pipefail

TOP_N="${1:-20}"
DAYS="${COVERAGE_PRIORITIES_DAYS:-90}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

SUMMARY="coverage/coverage-summary.json"
HAVE_COVERAGE=0
if [[ -f "$SUMMARY" ]]; then
  HAVE_COVERAGE=1
else
  echo "warn: $SUMMARY not found — treating all files as 0% covered." >&2
  echo "      Run 'npm run test:coverage' first for accurate ranking." >&2
fi

# All TS/TSX files under src/. Bash-3.2 portable (no `mapfile`).
FILES=()
while IFS= read -r line; do
  FILES+=("$line")
done < <(find src -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.d.ts' | sort)

# Extract coverage pct for a path (returns "0" if not present or no coverage run).
# Pure awk parse of the JSON — no python required. coverage-summary.json is
# flat enough that a regex on the "lines" object suffices; if the schema ever
# nests further, swap this to `node -e` (Node is already a dev-time dep).
coverage_for() {
  local path="$1"
  if [ "$HAVE_COVERAGE" = "0" ]; then
    echo "0"
    return
  fi
  local abs_target
  abs_target=$(cd "$(dirname "$path")" && pwd)/$(basename "$path")
  awk -v abs="$abs_target" -v rel="$path" '
    # Track the current top-level key (file path or "total")
    /^[[:space:]]*"[^"]+":[[:space:]]*\{/ {
      match($0, /"[^"]+"/)
      key = substr($0, RSTART+1, RLENGTH-2)
    }
    # Within the matching block, capture the lines pct
    (key == abs || index(key, "/" rel) == length(key) - length(rel)) &&
    /"lines":[[:space:]]*\{[^}]*"pct":[[:space:]]*[0-9.]+/ {
      match($0, /"pct":[[:space:]]*[0-9.]+/)
      pct = substr($0, RSTART+6, RLENGTH-6)
      gsub(/[^0-9.]/, "", pct)
      print pct
      exit
    }
    END { if (!pct) print 0 }
  ' "$SUMMARY" 2>/dev/null || echo "0"
}

SINCE="$DAYS days ago"

printf "%s\n" "Computing risk scores for ${#FILES[@]} files (churn window: $DAYS days)..." >&2

# Emit raw rows: score<TAB>churn<TAB>loc<TAB>fanout<TAB>coverage<TAB>path
ROWS_TMP=$(mktemp)
trap 'rm -f "$ROWS_TMP"' EXIT

for f in "${FILES[@]}"; do
  # churn — commits touching this file in the window
  churn=$(git log --since="$SINCE" --pretty=format:'%H' -- "$f" 2>/dev/null | wc -l | tr -d ' ')

  # loc — non-empty? wc -l counts newlines; close enough as a relative signal
  loc=$(wc -l <"$f" | tr -d ' ')

  # fanout — count distinct src files that import this one (by basename, no ext).
  # `|| true` so set -e doesn't kill us when grep finds nothing (common for
  # leaf utility files that nothing imports).
  base=$(basename "$f")
  stem="${base%.*}"
  fanout=$( { grep -rlF "$stem" src --include='*.ts' --include='*.tsx' 2>/dev/null || true; } \
    | { grep -vF "$f" || true; } | wc -l | tr -d ' ')

  cov=$(coverage_for "$f")

  # score = (churn * loc * fanout) / (cov + 1) — use awk for float division
  score=$(awk -v c="$churn" -v l="$loc" -v fo="$fanout" -v cv="$cov" \
    'BEGIN { printf "%.2f", (c * l * fo) / (cv + 1) }')

  printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$score" "$churn" "$loc" "$fanout" "$cov" "$f" >>"$ROWS_TMP"
done

# Sort by score descending, take top N, render as a friendly table
echo
printf "%-4s  %-12s  %-6s  %-6s  %-7s  %-8s  %s\n" \
  "rank" "score" "churn" "loc" "fanout" "cov%" "path"
printf "%-4s  %-12s  %-6s  %-6s  %-7s  %-8s  %s\n" \
  "----" "------------" "------" "------" "-------" "--------" "----"

sort -t$'\t' -k1,1 -gr "$ROWS_TMP" | head -n "$TOP_N" | nl -w3 -s'   ' | \
  awk -F'\t' 'BEGIN { OFS="" }
    {
      # nl prepends "  N\t<score>" — split that out
      split($1, a, "   ");
      rank = a[1]; score = a[2];
      printf "%-4s  %-12s  %-6s  %-6s  %-7s  %-8s  %s\n", \
        rank, score, $2, $3, $4, $5, $6
    }'
