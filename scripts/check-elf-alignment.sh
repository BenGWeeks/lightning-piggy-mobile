#!/usr/bin/env bash
# Audit the 16 KB page-size alignment of every native .so in an Android APK.
# Android 15+ on devices with 16 KB-capable hardware (Pixel 8 onwards) refuses
# to mmap libraries whose PT_LOAD segments aren't aligned to >= 16 KB. See
# https://developer.android.com/16kb-page-size and issue #377.
#
# Usage:
#   bash scripts/check-elf-alignment.sh path/to/app-debug.apk
#
# Exits 0 iff every .so in lib/arm64-v8a/ is aligned to 0x4000 or higher.
# Older 32-bit ABIs (armeabi-v7a, x86) are reported but not gated, since
# Pixel-class devices don't load them.
#
# CI hint: invoke this after `expo run:android` / `eas build --local` against
# the produced APK to gate merges on alignment regressions.
set -euo pipefail

APK="${1:-}"
if [[ -z "$APK" || ! -f "$APK" ]]; then
  echo "usage: $0 <apk>" >&2
  exit 2
fi

if ! command -v readelf >/dev/null; then
  echo "error: readelf not found (install binutils)" >&2
  exit 2
fi

THRESHOLD=$((16 * 1024))   # 16 KB = 0x4000
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

failed=0
arm64_total=0
arm64_aligned=0

# Collect arm64-v8a libs (the only ones Pixel-class devices load).
# Other ABIs are reported but ignored for the gate.
while IFS= read -r so; do
  case "$so" in
    lib/arm64-v8a/*) ;;
    *) continue ;;
  esac

  arm64_total=$((arm64_total + 1))
  unzip -p "$APK" "$so" > "$TMPDIR/probe.so" 2>/dev/null

  # Take the smallest PT_LOAD alignment across the file. If any segment is
  # below threshold, the whole .so is rejected by the Android loader.
  # readelf prints the alignment as a hex string (e.g. "0x4000"); bash
  # arithmetic accepts that natively, so we don't need gawk's strtonum.
  min_align=""
  while read -r hexalign; do
    [[ -z "$hexalign" ]] && continue
    val=$((hexalign))
    if [[ -z "$min_align" || "$val" -lt "$min_align" ]]; then
      min_align="$val"
    fi
  done < <(readelf -lW "$TMPDIR/probe.so" 2>/dev/null \
            | awk '/^  LOAD/ {print $NF}')

  if [[ -z "$min_align" ]]; then
    echo "  ?            $so   (no PT_LOAD found)"
    failed=1
    continue
  fi

  if (( min_align >= THRESHOLD )); then
    arm64_aligned=$((arm64_aligned + 1))
    printf "  \033[32m✓\033[0m %-#10x %s\n" "$min_align" "$so"
  else
    failed=1
    printf "  \033[31m✗\033[0m %-#10x %s\n" "$min_align" "$so"
  fi
done < <(unzip -l "$APK" | awk '/\.so$/ {print $NF}')

echo
echo "arm64-v8a: ${arm64_aligned}/${arm64_total} libraries 16 KB-aligned"

if (( failed )); then
  cat <<EOF >&2

ELF alignment check failed — at least one arm64-v8a library has a PT_LOAD
segment aligned to less than 16 KB (0x4000). Android 15+ on 16 KB-page hardware
will refuse to load it. See issue #377 for context and fix options.
EOF
  exit 1
fi

echo "OK — all arm64-v8a libs satisfy Android 16 KB page-size enforcement."
