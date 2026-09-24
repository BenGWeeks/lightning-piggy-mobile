#!/usr/bin/env bash
# Generate the Lightning Piggy app-icon set (#728): the Lucide "PiggyBank"
# outline (white) with a white Lucide "Zap" bolt in its body, on a per-variant
# radial gradient. Lucide icons are vector (SVG) — this rasterises them to the
# PNGs the iOS/Android icon pipelines require, so it's crisp at any size and
# fully re-tweakable. Edit the COLOURS / SCALES / glyphs below and run:
#
#     bash scripts/generate-app-icons.sh
#
# Requires ImageMagick (`convert`). Outputs into assets/:
#   icon.png / icon-dev.png / icon-preview.png   — iOS + general icon, per variant
#   android-icon-foreground.png                  — the mark (adaptive foreground)
#   android-icon-background[-dev|-preview].png    — gradient (adaptive background)
#   android-icon-monochrome.png                  — themed-icon mark (system-tinted)
#
# app.config.ts wires these per APP_VARIANT (see `icon` + `adaptiveIcon`).
# Production = pink, dev = blue, preview = purple — same pig+bolt mark on a
# radial gradient, so the three installs stay distinguishable.
#
# The pig path below is the verbatim Lucide PiggyBank v1.7.0 geometry (body +
# eye + tail), so the silhouette matches the icon set exactly.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v convert >/dev/null || { echo "ImageMagick 'convert' not found"; exit 1; }

# --- Tweakables -------------------------------------------------------------
SIZE=1024          # master icon size (square; the OS rounds the corners)
GLYPH_SCALE=576    # mark size within the full icon
FG_SCALE=490       # mark size for the Android adaptive foreground (safe zone)
MONO=432           # Android themed/monochrome icon size
MONO_MARK=234      # mark size within the monochrome canvas
MARK_BASE=1280     # canvas the mark is composed on (pig fills it)
STROKE=1.5         # pig outline stroke width (Lucide's native value)
BOLT_SCALE=370     # bolt size on the MARK_BASE canvas
BOLT_NUDGE_Y=0     # nudge the bolt vertically on the MARK_BASE canvas (+ = down)

BOLT_COLOUR='#ffffff'           # white lightning bolt (matches the outline)
GRAD_PROD='#FF2BA8-#B00069'     # pink   (brand / production)
GRAD_DEV='#5AA0EA-#2862A8'      # blue   (dev)
GRAD_PREVIEW='#A98BFA-#6D28D9'  # purple (preview)
# ---------------------------------------------------------------------------

# Portable mktemp: GNU coreutils accepts `mktemp -d` with no template, but
# BSD/macOS mktemp requires a template or `-t` (same pattern as
# scripts/check-elf-alignment.sh).
TMP=$(mktemp -d -t lp-app-icons.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

# Lucide PiggyBank v1.7.0 — body, eye, tail.
PIG_BODY='M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z'
PIG_EYE='M16 10h.01'
PIG_TAIL='M2 8v1a2 2 0 0 0 2 2h1'
ZAP='M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'

# Outline pig (all three Lucide sub-paths, white stroke) + solid bolt.
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="2048" height="2048"><g fill="none" stroke="#ffffff" stroke-width="%s" stroke-linecap="round" stroke-linejoin="round"><path d="%s"/><path d="%s"/><path d="%s"/></g></svg>' "$STROKE" "$PIG_BODY" "$PIG_EYE" "$PIG_TAIL" > "$TMP/pig.svg"
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="2048" height="2048"><path fill="%s" d="%s"/></svg>' "$BOLT_COLOUR" "$ZAP" > "$TMP/zap.svg"

# Trim viewBox padding so each glyph fills its box, then compose the mark:
# the bolt centred in the pig's body.
convert -background none "$TMP/pig.svg" -resize 2048x2048 -trim +repage "$TMP/pig.png"
convert -background none "$TMP/zap.svg" -resize 2048x2048 -trim +repage "$TMP/zap.png"
convert -size "${MARK_BASE}x${MARK_BASE}" xc:none \
  \( "$TMP/pig.png" -resize "${MARK_BASE}x${MARK_BASE}" \) -gravity center -composite \
  \( "$TMP/zap.png" -resize "${BOLT_SCALE}x${BOLT_SCALE}" \) -gravity center -geometry "+0$(printf '%+d' "$BOLT_NUDGE_Y")" -composite \
  "$TMP/mark.png"

# Full icon: gradient background + centred mark.
icon() { # <gradient> <outfile>
  convert -size "${SIZE}x${SIZE}" radial-gradient:"$1" \
    \( "$TMP/mark.png" -resize "${GLYPH_SCALE}x${GLYPH_SCALE}" \) \
    -gravity center -composite "$2"
}
# Adaptive background: gradient only (the mark is the foreground layer).
bg() { convert -size "${SIZE}x${SIZE}" radial-gradient:"$1" "$2"; }

icon "$GRAD_PROD" assets/icon.png
icon "$GRAD_DEV" assets/icon-dev.png
icon "$GRAD_PREVIEW" assets/icon-preview.png

bg "$GRAD_PROD" assets/android-icon-background.png
bg "$GRAD_DEV" assets/android-icon-background-dev.png
bg "$GRAD_PREVIEW" assets/android-icon-background-preview.png

# Android adaptive foreground: mark on transparent, padded to the safe zone.
convert -size "${SIZE}x${SIZE}" xc:none \
  \( "$TMP/mark.png" -resize "${FG_SCALE}x${FG_SCALE}" \) -gravity center -composite \
  assets/android-icon-foreground.png

# Android themed/monochrome: mark on transparent (the system tints it).
convert -size "${MONO}x${MONO}" xc:none \
  \( "$TMP/mark.png" -resize "${MONO_MARK}x${MONO_MARK}" \) -gravity center -composite \
  assets/android-icon-monochrome.png

# Web favicon — derived from the production icon (browsers downscale it).
convert assets/icon.png -resize 256x256 assets/favicon.png

echo "✓ app icons regenerated in assets/ (Lucide PiggyBank outline + white bolt; prod=pink, dev=blue, preview=purple; + favicon)"
