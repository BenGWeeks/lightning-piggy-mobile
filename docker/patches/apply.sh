#!/usr/bin/env bash
# Apply LNbits hot-fix patches to the lnbits-family container on black-panther.
# See README.md for context.

set -euo pipefail

HOST="${LNBITS_HOST:?set LNBITS_HOST to the ssh host running your lnbits container}"
CONTAINER="${LNBITS_CONTAINER:-lnbits}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

declare -A PATCHES=(
  ["lnbits_wallets_lndrest.py"]="/app/lnbits/wallets/lndrest.py"
  ["lnbits_core_services_nostr.py"]="/app/lnbits/core/services/nostr.py"
  ["lnbits_extensions_nwcprovider_tasks.py"]="/app/lnbits/extensions/nwcprovider/tasks.py"
)

echo "Applying LNbits patches to ${CONTAINER} on ${HOST}..."

for local_file in "${!PATCHES[@]}"; do
  container_path="${PATCHES[$local_file]}"
  src="${DIR}/${local_file}"
  [[ -f "$src" ]] || { echo "MISSING: $src" >&2; exit 1; }
  echo "  -> ${container_path}"
  scp -q "$src" "${HOST}:/tmp/${local_file}"
  ssh "$HOST" "docker cp /tmp/${local_file} ${CONTAINER}:${container_path} && \
               docker exec ${CONTAINER} python -c 'import ast; ast.parse(open(\"${container_path}\").read())'"
done

echo "Restarting ${CONTAINER}..."
ssh "$HOST" "docker restart ${CONTAINER}" >/dev/null
echo "Done. Tail logs with: ssh ${HOST} 'docker logs -f ${CONTAINER}'"
