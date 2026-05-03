#!/usr/bin/env bash
# Drives every keyboard-bearing input in the app and captures a screenshot
# of the focused state (with IME visible, when the OS shows it).
#
# Pre-reqs:
#   - AVD or device connected (adb devices)
#   - Logged into the app (Connect Nostr already done)
#   - These two AVD settings already applied:
#       adb shell settings put secure show_ime_with_hard_keyboard 1
#       adb shell settings put secure stylus_handwriting_enabled 0
#   - ImageMagick installed (for resize)
#   - The Messages tab has a 1:1 conversation visible from "Daniel Prince"
#     and a group named "TestGroup Abc" (used by flows 06, 09, 11). See
#     docs/keyboard-audit.adoc § Fixture data prereqs.
#
# Output: docs/screenshots/keyboard-states/<surface>.png
#
# Run a single flow:  FLOW=03-friend-picker-search ./scripts/keyboard-screenshot-audit.sh
# Override device:    DEVICE=emulator-5556 ./scripts/keyboard-screenshot-audit.sh

set -uo pipefail

OUT_DIR="docs/screenshots/keyboard-states"
mkdir -p "$OUT_DIR"

# Hardcoded to match the appId in every YAML flow under
# tests/e2e/keyboard-audit/. If you re-point at a release variant,
# update both this constant AND the appId line in every flow file —
# they have to stay in lockstep or `am force-stop` ends up killing
# the wrong package while Maestro drives the original.
PKG="com.lightningpiggy.app.dev"

# Auto-detect a single attached device. With multiple devices, set
# DEVICE explicitly (export DEVICE=emulator-5554) — adb without -s
# fails ambiguously when more than one is attached.
if [ -z "${DEVICE:-}" ]; then
  DEVICE_COUNT=$(adb devices | tail -n +2 | grep -c $'\tdevice$' || true)
  if [ "$DEVICE_COUNT" -eq 1 ]; then
    DEVICE=$(adb devices | tail -n +2 | grep $'\tdevice$' | awk '{print $1}')
  elif [ "$DEVICE_COUNT" -gt 1 ]; then
    echo "ERROR: $DEVICE_COUNT devices attached. Set DEVICE=<serial> explicitly." >&2
    adb devices >&2
    exit 2
  else
    echo "ERROR: no devices attached." >&2
    exit 2
  fi
fi
ADB="adb -s $DEVICE"

capture () {
  local name="$1"
  local raw="/tmp/${name}_raw.png"
  local out="${OUT_DIR}/${name}.png"

  for _ in $(seq 1 8); do
    if $ADB shell dumpsys input_method 2>/dev/null | grep -q 'mInputShown=true'; then
      break
    fi
    sleep 0.5
  done

  if ! $ADB exec-out screencap -p > "$raw"; then
    echo "  ✗ screencap failed for $name (adb returned non-zero)"
    rm -f "$raw"
    return 1
  fi
  # Bail on a 0-byte / empty PNG — happens occasionally if the device
  # screen-locks mid-capture. Better a loud failure than a corrupt PNG
  # silently committed.
  if [ ! -s "$raw" ]; then
    echo "  ✗ screencap returned 0-byte file for $name"
    rm -f "$raw"
    return 1
  fi
  if command -v convert >/dev/null 2>&1; then
    convert "$raw" -resize 1200x1200\> "$out"
    rm -f "$raw"
  else
    mv "$raw" "$out"
  fi
  echo "  ✓ saved $out"
}

relaunch () {
  $ADB shell am force-stop "$PKG"
  sleep 0.5
  $ADB shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 3
}

run_flow () {
  local flow="$1"
  local name="$2"
  echo "▶ $name"
  maestro --device "$DEVICE" test "$flow" >/tmp/m_${name}.log 2>&1
  local rc=$?
  # Capture regardless of pass/fail — failures are themselves diagnostic
  # (they often mean the input or surrounding sheet didn't render
  # correctly, which is the kind of bug this audit is meant to surface).
  capture "$name"
  if [ $rc -ne 0 ]; then
    echo "  ⚠ flow failed (rc=$rc) — captured anyway; see /tmp/m_${name}.log"
  fi
}

SHOW_IME=$($ADB shell settings get secure show_ime_with_hard_keyboard | tr -d '\r\n')
STYLUS=$($ADB shell settings get secure stylus_handwriting_enabled | tr -d '\r\n')
echo "Device: $DEVICE  |  show_ime_with_hard_keyboard=$SHOW_IME stylus_handwriting_enabled=$STYLUS"
if [ "$SHOW_IME" != "1" ]; then
  echo "WARN: show_ime_with_hard_keyboard != 1 — IME may not appear"
fi

FLOWS=(
  "01-messages-search"
  "02-friends-search"
  "03-friend-picker-search"
  "04-create-group-name"
  "05-add-friend-npub"
  "06-conversation-input"
  "07-feedback-input"
  "08-edit-profile-name"
  "09-gif-search"
  "10-send-paste"
  "11-rename-group"
  "12-add-wallet-nwc"
)

FILTER="${FLOW:-}"
for f in "${FLOWS[@]}"; do
  if [ -n "$FILTER" ] && [ "$f" != "$FILTER" ]; then continue; fi
  run_flow "tests/e2e/keyboard-audit/${f}.yaml" "$f"
  relaunch
done

echo "Done. Screenshots in $OUT_DIR/"
