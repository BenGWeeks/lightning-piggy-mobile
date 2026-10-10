#!/usr/bin/env bash
# Decide whether a change touches anything the slow native CI jobs validate.
#
# Reads changed file paths on stdin (one per line) and exits 0 as soon as one
# is native-relevant (printing it to stderr), or exits 1 if none are.
# Used by the `changes` job in .github/workflows/ci.yml — keep the pattern
# list below in sync with what those jobs actually build/run. Err on the side
# of running: a false positive costs CI minutes, a false negative ships an
# unvalidated native build.
#
# Usage:
#   git diff --name-only origin/main...HEAD | bash scripts/ci-native-paths.sh
set -u

NATIVE_PATTERNS='^(
android/
|ios/
|modules/
|plugins/
|vendor/
|patches/
|assets/
|scripts/ios-tests/
|\.github/workflows/ci\.yml$
|app\.config\.ts$
|app\.json$
|eas\.json$
|google-services\.json$
|package\.json$
|package-lock\.json$
|\.npmrc$
|\.nvmrc$
|babel\.config\.js$
|metro\.config\.js$
|index\.ts$
|App\.tsx$
|scripts/(
check-elf-alignment(\.test)?\.(sh|mjs)$
|download-sdk-artifact(\.test)?\.mjs$
|fetch-nostr-sdk-swift(\.test)?\.mjs$
|native-sdk-manifest(\.test)?\.mjs$
|ci-native-paths\.sh$
)
)'
# Collapse the readable multi-line form above into one ERE.
NATIVE_PATTERNS=$(printf '%s' "$NATIVE_PATTERNS" | tr -d '\n')

while IFS= read -r path; do
  [ -n "$path" ] || continue
  if printf '%s\n' "$path" | grep -Eq "$NATIVE_PATTERNS"; then
    echo "native-relevant: $path" >&2
    exit 0
  fi
done
exit 1
