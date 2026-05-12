#!/usr/bin/env bash
#
# Offline cold-start E2E — disables Wi-Fi + mobile data, force-stops +
# cold-launches the app, then runs the Maestro flow that asserts every
# cached surface paints. Network is re-enabled in a `trap` so a test
# failure doesn't strand the device offline.
#
# Why a shell wrapper instead of all-Maestro? Maestro can't toggle
# Android's `svc wifi` / `svc data` directly — we need adb shell. The
# Maestro flow itself just exercises the UI under the (offline) state
# the wrapper sets up.
#
# Usage:
#   bash scripts/test-offline-cold-start.sh                       # default device
#   DEVICE=37111FDJH0067B bash scripts/test-offline-cold-start.sh  # Pixel
#   DEVICE=emulator-5554 PKG=com.lightningpiggy.app.dev \
#     bash scripts/test-offline-cold-start.sh                     # AVD / dev variant
#
# Pre-reqs:
#   - Device is unlocked + on Home/launcher
#   - App has been opened at least once so caches exist on disk
#     (BTC Map dataset, NIP-GC + NIP-52 events, contacts, tx list, etc.)
#
# Exit 0 = all surfaces painted from cache; non-zero = at least one
# surface failed to render without network.
#
set -u

DEVICE="${DEVICE:-${PIXEL_DEVICE:-37111FDJH0067B}}"
PKG="${PKG:-${PIXEL_PKG:-com.lightningpiggy.app}}"
FLOW="${FLOW:-tests/e2e/test-offline-cold-start.yaml}"

ADB="adb -s $DEVICE"

if ! $ADB shell pm path "$PKG" >/dev/null 2>&1; then
  echo "✗ Package $PKG not installed on $DEVICE" >&2
  exit 2
fi

echo "→ Offline-cold-start test"
echo "   device: $DEVICE"
echo "   pkg:    $PKG"
echo "   flow:   $FLOW"
echo

# Always re-enable the radio when we leave — even on test failure or
# Ctrl-C. Without this an exit mid-test would leave the user's device
# in airplane-ish state until they remember to flip it back.
restore_network() {
  echo "→ Re-enabling network…"
  $ADB shell svc wifi enable >/dev/null 2>&1 || true
  $ADB shell svc data enable >/dev/null 2>&1 || true
}
trap restore_network EXIT INT TERM

echo "→ Disabling Wi-Fi + mobile data…"
$ADB shell svc wifi disable || true
$ADB shell svc data disable || true
# Give the OS a moment to actually tear the radios down — without this
# pause the first relay query in WalletContext can still ride the dying
# socket and confuse the "did we render from cache?" assertion.
sleep 3

echo "→ Force-stop + cold launch $PKG…"
$ADB shell am force-stop "$PKG"
sleep 1
$ADB shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

# Wait for first frame so the Maestro launch handshake doesn't race the
# app's splash.
sleep 5

echo "→ Running Maestro flow…"
if maestro --device "$DEVICE" test "$FLOW"; then
  echo
  echo "✓ All cached surfaces painted without internet."
  exit 0
else
  echo
  echo "✗ One or more surfaces failed to render offline." >&2
  exit 1
fi
