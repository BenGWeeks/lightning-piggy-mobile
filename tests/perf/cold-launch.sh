#!/usr/bin/env bash
# Cold-launch perf: force-stop → launch → Home tab content visible.
# Exercises BootSplash dwell, WalletContext boot, NWC enable deferral,
# and the first render of the Home carousel.
set +e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"

echo "=== COLD LAUNCH ($PKG on $DEVICE) ==="
adb -s "$DEVICE" shell am force-stop "$PKG"
sleep 1

cat > "$LOGDIR/_cold.yaml" <<EOF
appId: $PKG
---
- launchApp
- extendedWaitUntil:
    visible:
      id: 'tab-home'
    timeout: 30000
- extendedWaitUntil:
    visible:
      text: '${GREETING}.*'
    timeout: 30000
EOF

time_step "cold-launch → $GREETING" "$LOGDIR/_cold.yaml"
