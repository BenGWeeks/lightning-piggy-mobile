#!/bin/bash
# Run all E2E tests in order.
# Prerequisites: app installed, Metro running, .env configured
# Usage: source .env && bash tests/e2e/run-all.sh

set -e

echo "=== Setup: Add NWC Wallet 1 ==="
maestro test -e MAESTRO_NWC="$MAESTRO_NWC1" -e WALLET_NAME="Wallet 1" tests/e2e/test-add-nwc-wallet.yaml

echo ""
echo "=== Setup: Add NWC Wallet 2 ==="
maestro test -e MAESTRO_NWC="$MAESTRO_NWC2" -e WALLET_NAME="Wallet 2" tests/e2e/test-add-nwc-wallet.yaml

echo ""
echo "=== Test: Transfer 5 sats ==="
maestro test tests/e2e/test-transfer.yaml

echo ""
echo "=== Test: Swipe Speed ==="
maestro test tests/e2e/test-swipe-speed.yaml

echo ""
echo "=== All tests passed! ==="
