#!/usr/bin/env bash
# eas-deploy-pixel.sh — kick off `eas build --local --profile production`,
# fail fast if the determined versionCode won't install on the Pixel,
# install + run perf-suite if it will.
#
# Why fail-fast: eas-cli prints "Incrementing versionCode from N to M"
# in the [CONFIGURE_ANDROID_VERSION] phase, which runs ~60 seconds into
# a 20-minute build. If M is less than the device's current versionCode,
# the install at the end of the build will fail with
# INSTALL_FAILED_VERSION_DOWNGRADE — so detect at line ~20 of the log
# and abort, saving ~19 min.
set -uo pipefail

PIXEL=${PIXEL_SERIAL:-37111FDJH0067B}
PACKAGE=com.lightningpiggy.app
LOG_DIR=/tmp
BUILD_LOG="$LOG_DIR/eas-deploy-pixel-build.log"
CHAIN_LOG="$LOG_DIR/eas-deploy-pixel-chain.log"

DEVICE_VC=$(adb -s "$PIXEL" shell dumpsys package "$PACKAGE" 2>/dev/null | grep -oP 'versionCode=\K\d+' | head -1)
echo "device $PIXEL has $PACKAGE versionCode=$DEVICE_VC"
[ -z "$DEVICE_VC" ] && { echo "could not read device versionCode — is Pixel connected?"; exit 1; }

echo "starting eas build --local in background (logs: $BUILD_LOG)"
# `setsid` puts the build in its own process group so we can kill the whole
# tree later (eas-cli spawns npm, npx, java/gradle, kotlin daemons — a plain
# kill on the parent leaves them as cpu-burning orphans).
setsid bash -c "TMPDIR=\"$HOME/eas-tmp\" eas build --local --profile production --platform android --non-interactive" >"$BUILD_LOG" 2>&1 &
BUILD_PID=$!
echo "build PID=$BUILD_PID (process group $BUILD_PID)"

# Helper: kill the entire build process group + any stray gradle/kotlin daemons
kill_build_tree() {
  kill -TERM -- -"$BUILD_PID" 2>/dev/null
  sleep 2
  kill -KILL -- -"$BUILD_PID" 2>/dev/null
  # Gradle + Kotlin daemons detach into their own pgroups; pattern-kill them
  pkill -KILL -f "GradleDaemon" 2>/dev/null
  pkill -KILL -f "kotlin.daemon.KotlinCompileDaemon" 2>/dev/null
  pkill -KILL -f "eas-cli-local-build-plugin" 2>/dev/null
  true
}

# Phase 1: watch for the versionCode determination, fail fast if too low.
# eas-cli emits "Version code: NN" within the first ~1% of the build (~60s).
# Give it 5 min to reach that line — far longer than needed, but generous if
# the box is loaded.
echo "phase 1: waiting up to 5 min for versionCode determination"
TIMEOUT=$((SECONDS + 300))
NEW_VC=
while [ $SECONDS -lt $TIMEOUT ]; do
  NEW_VC=$(grep -oP 'Version code: \K\d+' "$BUILD_LOG" 2>/dev/null | head -1)
  [ -n "$NEW_VC" ] && break
  kill -0 "$BUILD_PID" 2>/dev/null || { echo "build exited before versionCode line"; tail -20 "$BUILD_LOG"; exit 1; }
  sleep 10
done

if [ -z "$NEW_VC" ]; then
  echo "TIMEOUT — no versionCode line in 5 min. killing build."
  kill_build_tree
  exit 1
fi

echo "build will produce versionCode=$NEW_VC (device has $DEVICE_VC)"
if [ "$NEW_VC" -le "$DEVICE_VC" ]; then
  echo "ABORT — $NEW_VC <= $DEVICE_VC, install would fail with VERSION_DOWNGRADE"
  echo "killing build to save ~19 min"
  kill_build_tree
  exit 2
fi

# Phase 2: build is going to produce an installable APK. Wait for it.
echo "versionCode OK — letting build complete"
wait "$BUILD_PID"
BUILD_RC=$?
[ $BUILD_RC -ne 0 ] && { echo "build failed rc=$BUILD_RC"; tail -30 "$BUILD_LOG"; exit $BUILD_RC; }

cd /home/benw/GitHub/lightning-piggy-mobile
APK=$(ls -1t build-*.apk 2>/dev/null | head -1)
[ -z "$APK" ] && { echo "no APK produced"; exit 1; }
echo "APK = $APK"

echo "installing on $PIXEL"
INSTALL_OUT=$(adb -s "$PIXEL" install -r "$APK" 2>&1)
echo "$INSTALL_OUT"
echo "$INSTALL_OUT" | grep -q "Failure\|INSTALL_FAILED" && exit 3

NEW_DEVICE_VC=$(adb -s "$PIXEL" shell dumpsys package "$PACKAGE" | grep -oP 'versionCode=\K\d+' | head -1)
echo "device now reports versionCode=$NEW_DEVICE_VC"

echo "perf-suite"
SERIAL="$PIXEL" PACKAGE="$PACKAGE" bash scripts/perf-suite.sh
