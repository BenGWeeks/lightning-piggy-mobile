#!/usr/bin/env bash
# Print user-facing release notes from merged Conventional Commit PR titles.
# Usage: scripts/release-notes-from-prs.sh <from-tag> <to-ref>
# Use an empty from-tag for the first release. Requires full Git history, gh, jq.
set -euo pipefail
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <from-tag> <to-ref>" >&2
  exit 2
fi
from=$1
to=$2
git rev-parse --verify "${to}^{commit}" >/dev/null
until=$(TZ=UTC git show -s --date=format-local:%Y-%m-%dT%H:%M:%SZ --format=%cd "${to}^{commit}")
if [ -n "$from" ]; then
  git rev-parse --verify "${from}^{commit}" >/dev/null
  since=$(TZ=UTC git show -s --date=format-local:%Y-%m-%dT%H:%M:%SZ --format=%cd "${from}^{commit}")
else
  since=1970-01-01T00:00:00Z
fi
# Search dates bound the API query; ancestry below enforces the actual tag range
# and excludes PRs merged to main after the release's source commit.
prs=$(gh pr list --state merged --base main --search "merged:${since}..${until}" \
  --limit 10000 --json number,title,mergedAt,mergeCommit)
if [ "$(jq 'length' <<<"$prs")" -ge 10000 ]; then
  echo 'Release range exceeds the PR query limit; refusing incomplete notes.' >&2
  exit 1
fi
selected=$(mktemp)
trap 'rm -f "$selected"' EXIT
while IFS= read -r pr; do
  sha=$(jq -r '.mergeCommit.oid // empty' <<<"$pr")
  [ -n "$sha" ] || { echo 'Merged PR has no merge commit.' >&2; exit 1; }
  git cat-file -e "${sha}^{commit}"
  if git merge-base --is-ancestor "$sha" "$to" &&
    { [ -z "$from" ] || ! git merge-base --is-ancestor "$sha" "$from"; }; then
    printf '%s\n' "$pr" >> "$selected"
  fi
done < <(jq -c '.[]' <<<"$prs")
jq -sr '
  sort_by(.mergedAt, .number)
  | map(. + {parsed: (.title | capture("^(?<type>feat|perf|refactor|fix)(\\([^)]*\\))?!?:\\s*(?<subject>.+)$"; "i"))})
  | map(. + {subject: (.parsed.subject | sub("\\s*\\(#[0-9]+(,\\s*#[0-9]+)*\\)\\s*$"; "") | gsub("[\\r\\n]"; " "))})
  | . as $prs
  | [{heading: "New", types: ["feat"]},
     {heading: "Improved", types: ["perf", "refactor"]},
     {heading: "Fixed", types: ["fix"]}]
  | map(. as $group | [$prs[] | select((.parsed.type | ascii_downcase) as $type | $group.types | index($type))]
      | if length == 0 then empty else
          "### " + $group.heading + "\n\n" + (map("- " + (.subject | (.[0:1] | ascii_upcase) + .[1:]) + " (#" + (.number | tostring) + ")") | join("\n"))
        end)
  | if length == 0 then "Bug fixes and improvements." else join("\n\n") end
' "$selected"
