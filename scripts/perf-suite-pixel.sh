#!/usr/bin/env bash
#
# Pixel-defaults wrapper around perf-suite.sh.
#
# Sets sensible defaults for a Pixel running the production build,
# but every value is overridable from the caller's environment so the
# wrapper isn't tied to one specific device or one specific install.
#
#   npm run perf:pixel                       # uses defaults below
#   PIXEL_DEVICE=99XXXXX npm run perf:pixel  # different Pixel
#   PIXEL_PKG=com.lightningpiggy.app.preview \
#     npm run perf:pixel                     # preview-channel build
#
# SAMPLES can also be overridden — the perf:pixel:quick / :long
# aliases just set it to 1 / 5 respectively.

set -u

# All three knobs respect existing env vars first, falling back to
# defaults that match Ben's Pixel + production install.
DEVICE="${DEVICE:-${PIXEL_DEVICE:-37111FDJH0067B}}"
PKG="${PKG:-${PIXEL_PKG:-com.lightningpiggy.app}}"
SAMPLES="${SAMPLES:-3}"

export DEVICE PKG SAMPLES
exec bash "$(dirname "$0")/perf-suite.sh"
