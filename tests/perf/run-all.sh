#!/usr/bin/env bash
# Convenience wrapper: cold-launch → tab-nav → thread-open.
# Each sub-script is self-contained; this one just chains them and
# prints a header between runs.
set +e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

banner() { printf "\n\n##### %s #####\n\n" "$1"; }

banner "1/3 COLD LAUNCH"
bash "$SCRIPT_DIR/cold-launch.sh"

banner "2/3 TAB NAV"
bash "$SCRIPT_DIR/tab-nav.sh"

banner "3/3 THREAD OPEN"
bash "$SCRIPT_DIR/thread-open.sh"
