#!/usr/bin/env bash
# Conversation-open perf: cold cache vs warm cache thread open.
# Open 1 = tap peer row → wait for $SEED text (first decrypt round-trip).
# Open 2 = back to Messages, tap again → wait for $SEED (cache hit).
#
# The [Perf] fetchConversation log line shows hits= / fresh= counters —
# cold should be hits=0 fresh=N, warm should be hits≈N fresh=0.
set +e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"

echo "=== THREAD OPEN ($PKG on $DEVICE, peer=$PEER) ==="
PID=$(require_app_running)

LOG="$LOGDIR/thread-open.log"
start_logcat "$PID" "$LOG"
trap stop_logcat EXIT

# Navigate to Messages first (idempotent).
cat > "$LOGDIR/_msgs.yaml" <<EOF
appId: $PKG
---
- tapOn:
    id: 'tab-messages'
- extendedWaitUntil:
    visible:
      text: '$PEER'
    timeout: 15000
EOF
time_step "goto messages" "$LOGDIR/_msgs.yaml"

cat > "$LOGDIR/_open.yaml" <<EOF
appId: $PKG
---
- tapOn:
    text: '$PEER'
- extendedWaitUntil:
    visible:
      text: '$SEED'
    timeout: 60000
EOF

cat > "$LOGDIR/_back.yaml" <<EOF
appId: $PKG
---
- pressKey: back
- extendedWaitUntil:
    visible:
      text: 'Messages'
    timeout: 10000
EOF

echo
time_step "open 1 (cold)"  "$LOGDIR/_open.yaml"
time_step "back to inbox"  "$LOGDIR/_back.yaml"
time_step "open 2 (warm)"  "$LOGDIR/_open.yaml"

echo
echo "=== [Perf] fetchConversation lines ==="
grep "\[Perf\] fetchConversation" "$LOG" | tail -5
