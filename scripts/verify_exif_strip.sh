#!/usr/bin/env bash
#
# EXIF-strip e2e verifier for PR #156 / issue #145.
#
# Maestro can drive the UI but can't read HTTP bodies or image bytes,
# so this wrapper does both: Maestro does the upload flow (picker -> crop
# -> Amber/nsec sign -> Blossom PUT), this script watches logcat for the
# resulting Blossom URL, downloads the image, and asserts exiftool sees
# zero user-identifying EXIF tags.
#
# Prerequisites (one-time setup):
#   sudo apt install libimage-exiftool-perl    # Debian/Ubuntu
#   # OR: brew install exiftool                # macOS
#
# Run (with emulator / device connected, app already installed):
#   scripts/verify_exif_strip.sh
#
# Exit codes:
#   0 — upload completed, stripped image has no GPS/Make/Model/Date tags.
#   1 — setup failure (missing exiftool, no adb device, etc).
#   2 — upload flow failed (Maestro exited non-zero).
#   3 — EXIF tags survived the strip — PRIVACY REGRESSION.

set -euo pipefail

PACKAGE="com.lightningpiggy.app.dev"
FIXTURE="/tmp/exif-loaded-fixture.jpg"
DOWNLOAD="/tmp/exif-uploaded.jpg"
LOGCAT_TAG="ReactNativeJS"
MAESTRO_FLOW="tests/e2e/test-exif-strip.yaml"

# ---- preflight ----
command -v exiftool >/dev/null 2>&1 || {
  echo "FAIL: exiftool not found — install with: sudo apt install libimage-exiftool-perl"
  exit 1
}
command -v adb >/dev/null 2>&1 || { echo "FAIL: adb not found"; exit 1; }
command -v convert >/dev/null 2>&1 || { echo "FAIL: ImageMagick not found"; exit 1; }
command -v maestro >/dev/null 2>&1 || { echo "FAIL: maestro not found"; exit 1; }
adb get-state >/dev/null 2>&1 || { echo "FAIL: no adb device attached"; exit 1; }

# ---- build a fixture JPEG with known EXIF ----
# A plain blank JPEG that we then tag via exiftool, so the "known good"
# tags are fully under our control and we have a stable diff target.
echo "[1/5] Building fixture JPEG with known EXIF tags..."
convert -size 1024x1024 xc:"#336699" "$FIXTURE"
exiftool -overwrite_original \
  -GPSLatitude=51.5074 -GPSLatitudeRef=N \
  -GPSLongitude=-0.1278 -GPSLongitudeRef=W \
  -Make='ACME' -Model='TestCam 9000' \
  -DateTimeOriginal='2024:06:15 13:45:00' \
  -Software='verify_exif_strip.sh' \
  "$FIXTURE" >/dev/null

# sanity-check the fixture really has the tags we want to strip
FIX_TAGS=$(exiftool -s -s -s -GPSLatitude -Make -Model -DateTimeOriginal "$FIXTURE" | grep -cv '^$')
if [ "$FIX_TAGS" -lt 4 ]; then
  echo "FAIL: fixture builder didn't embed all 4 EXIF tags (only $FIX_TAGS)"
  exit 1
fi

# ---- push to emulator photo library ----
# adb push transfers a file from the host to the device; /sdcard/Pictures
# is the canonical user-visible photo directory and what the Android photo
# picker surfaces by default. The `am broadcast` nudge asks the media
# scanner to index the new file so it shows up in the picker immediately.
echo "[2/5] Pushing fixture to /sdcard/Pictures/..."
adb push "$FIXTURE" /sdcard/Pictures/exif-loaded-fixture.jpg >/dev/null
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
  -d "file:///sdcard/Pictures/exif-loaded-fixture.jpg" >/dev/null

# ---- clear logcat + launch the Maestro flow ----
echo "[3/5] Running Maestro flow (watching logcat for [Blossom] uploaded ...)..."
adb logcat -c
LOGFILE=$(mktemp)
adb logcat -v brief "$LOGCAT_TAG:I" '*:S' > "$LOGFILE" &
LOGCAT_PID=$!
trap 'kill $LOGCAT_PID 2>/dev/null || true; rm -f "$LOGFILE"' EXIT

if ! maestro test "$MAESTRO_FLOW"; then
  echo "FAIL: Maestro flow failed — upload didn't complete"
  exit 2
fi

# give logcat a moment to flush the last [Blossom] line
sleep 2

# ---- extract Blossom URL from logcat ----
# Match URL up to but not including whitespace/quote characters, ending at
# a recognised image extension. The Blossom log line quotes the URL with
# single quotes (`'https://.../abc.jpg'`) — stopping at the quote keeps
# them out of the captured URL.
URL=$(grep -oE "https?://[^ '\"]+\.(jpg|jpeg|png|webp)" "$LOGFILE" | head -n1 || true)
if [ -z "$URL" ]; then
  echo "FAIL: no Blossom URL logged — check blossomService console.log"
  tail -40 "$LOGFILE"
  exit 2
fi
echo "[4/5] Uploaded URL: $URL"

# ---- download + assert ----
echo "[5/5] Downloading and checking EXIF tags..."
curl -sSL "$URL" -o "$DOWNLOAD"

LEAKED=""
for tag in GPSLatitude GPSLongitude Make Model DateTimeOriginal Software; do
  val=$(exiftool -s -s -s -"$tag" "$DOWNLOAD" || true)
  if [ -n "$val" ]; then
    LEAKED="$LEAKED\n  $tag: $val"
  fi
done

if [ -n "$LEAKED" ]; then
  echo
  echo "FAIL: EXIF tags survived the strip — PRIVACY REGRESSION:"
  echo -e "$LEAKED"
  exit 3
fi

echo
echo "PASS: no GPS/Make/Model/Date/Software tags on uploaded image."
echo "Remaining metadata is just JFIF / dimensions (image-manipulator re-encode artefacts)."
