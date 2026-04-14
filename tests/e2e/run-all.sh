#!/bin/bash
# Run all E2E tests in order.
# Prerequisites: app installed, Metro running, .env configured, dev mode enabled
# Usage: source .env && bash tests/e2e/run-all.sh

set -e

echo "=== Setup: Enable Developer Mode ==="
maestro test tests/e2e/test-dev-mode.yaml

echo ""
echo "=== Setup: Add NWC Wallet 1 ==="
maestro test -e MAESTRO_NWC="$MAESTRO_NWC1" -e WALLET_NAME="Wallet 1" tests/e2e/test-add-nwc-wallet.yaml

echo ""
echo "=== Setup: Add NWC Wallet 2 ==="
maestro test -e MAESTRO_NWC="$MAESTRO_NWC2" -e WALLET_NAME="Wallet 2" tests/e2e/test-add-nwc-wallet.yaml

echo ""
echo "=== Setup: Add Hot Wallet 1 ==="
maestro test -e MAESTRO_MNEMONIC="$MAESTRO_MNEMONIC1" -e WALLET_NAME="Hot Wallet 1" tests/e2e/test-add-hot-wallet.yaml

echo ""
echo "=== Setup: Add Hot Wallet 2 ==="
maestro test -e MAESTRO_MNEMONIC="$MAESTRO_MNEMONIC2" -e WALLET_NAME="Hot Wallet 2" tests/e2e/test-add-hot-wallet.yaml

echo ""
echo "=== Setup: Add Watch-Only Wallet ==="
maestro test -e MAESTRO_XPUB="$MAESTRO_XPUB3" -e WALLET_NAME="Watch Wallet 1" tests/e2e/test-add-onchain-wallet.yaml

echo ""
echo "=== Test: Transfer LN → LN (7 sats) ==="
maestro test tests/e2e/test-transfer-ln-to-ln.yaml

echo ""
echo "=== Test: Transfer LN → On-chain (26,000 sats via Boltz) ==="
maestro test tests/e2e/test-transfer-ln-to-onchain.yaml

echo ""
echo "=== Test: Transfer On-chain → LN (26,000 sats via Boltz) ==="
maestro test tests/e2e/test-transfer-onchain-to-ln.yaml

echo ""
echo "=== Test: Transfer On-chain → On-chain (26,000 sats) ==="
maestro test tests/e2e/test-transfer-onchain-to-onchain.yaml

echo ""
echo "=== Test: Swipe Speed ==="
maestro test tests/e2e/test-swipe-speed.yaml

echo ""
echo "=== All tests passed! ==="
