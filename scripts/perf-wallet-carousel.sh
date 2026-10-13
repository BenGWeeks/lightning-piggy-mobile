#!/usr/bin/env bash
# Compare native frame times during wallet-carousel gestures on two builds.
# Capture each file with: adb -s <device> shell dumpsys gfxinfo <package> framestats
# Reset that package's gfxinfo before the same gesture sequence on each build.
# Usage: bash scripts/perf-wallet-carousel.sh before-frames.txt after-frames.txt
set -euo pipefail
python3 - "$@" <<'PY'
import csv
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit('Usage: perf-wallet-carousel.sh BEFORE_FRAMESTATS AFTER_FRAMESTATS')

def frame_times(path):
    columns = None
    frames = []
    for line in Path(path).read_text().splitlines():
        row = next(csv.reader([line]))
        if 'IntendedVsync' in row and 'FrameCompleted' in row:
            columns = {name: index for index, name in enumerate(row)}
            continue
        if not columns or not row or not row[0].isdigit():
            continue
        try:
            if int(row[columns['Flags']]) != 0:
                continue
            start = int(row[columns['IntendedVsync']])
            end = int(row[columns['FrameCompleted']])
        except (ValueError, IndexError):
            continue
        if 0 < start < end < 2**63 - 1:
            frames.append((end - start) / 1_000_000)
    if not frames:
        raise SystemExit(f'No completed native frames in {path}')
    return sorted(frames)

def percentile(values, fraction):
    position = (len(values) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(values) - 1)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)

for label, path in zip(('Before', 'After'), sys.argv[1:]):
    values = frame_times(path)
    print(f'{label}: frames={len(values)} p50={percentile(values, .5):.1f}ms '
          f'p95={percentile(values, .95):.1f}ms max={values[-1]:.1f}ms')
PY
