# Morning notes — 2026-05-16

What's running unattended overnight + what you'll find when you check.

## ✅ New PRs opened

| PR | Branch | Purpose | State |
|---|---|---|---|
| [#562](https://github.com/BenGWeeks/lightning-piggy-mobile/pull/562) | `perf/render-profiler-nip17-yield` | React.Profiler on Home + Explore + NIP-17 yield 4 → 2 | open |
| [#563](https://github.com/BenGWeeks/lightning-piggy-mobile/pull/563) | `feat/maplibre-native` | MapLibre Native scaffolding (#552 — replace Leaflet WebView) | **draft** |

Both target `feat/explore-tab` as base.

## 🟡 EAS preview build (Android) — in progress

- Build ID: `8df2bfd8-bc7f-46b2-b830-7c1ef53c450d`
- Profile: `preview` · platform: `android`
- Commit: `c9d11d2` (latest at build kick-off, before the perf + MapLibre branches)
- Dashboard: https://expo.dev/accounts/bengweeks/projects/lightning-piggy-app/builds/8df2bfd8-bc7f-46b2-b830-7c1ef53c450d
- Started: 01:06 UTC
- **To install on Pixel:** download APK from the dashboard, `adb -s 37111FDJH0067B install -r <file>.apk`.

## 🟡 Perf-suite baseline (AVD) — running

- Output: `/tmp/perf-suite-1778890010/summary.md` (currently empty table — script is mid-run through later surfaces; final table populates on completion)
- Per-sample dumps: `/tmp/perf-suite-1778890010/*.txt` and `*.maestro.log`
- Live log: `/tmp/perf-run.log`
- Samples: 2 each across ~8 surfaces (Home, Messages, Friends, Explore tabs + Explore-places, Explore-caches, Hunt-list, scroll)
- Captures legacy-jank + modern-jank + p99 frame time

## ✅ Shipped on `feat/explore-tab` since you went to bed

| Hash | What |
|---|---|
| `883cd54` | Two findings from PR #488 sub-agent review (fetchCache/fetchEvent maxWait + piggyStorage expiresAt) |
| `b77e63f` | Merge PR #548 — three-tier WoT chip for Messages |
| `1d5778c` | Merge PR #550 — Places rail cold-start paint |
| `33f65c5` | Merge PR #551 — Leaflet bridge refactor |
| `08ef469` | Try prize hidden when no sats advertised |
| `c9d11d2` | popToTop on Explore tab tap (StackActions, prior `navigate()` was a no-op when already focused) |
| `9c33f71` | This file — overnight status |
| `fc4ffe1` | Comment refresh on `test-explore-tab-rename.yaml` to match rails layout |

PRs #556 + #557 were already cherry-picked into the branch earlier, so they're not separate merge commits but the code is there.

## ✅ PR #488 description

Rewritten as one 30-cell, 3-column screenshot table per your spec. Earlier multi-table layout is gone. Summary, NIP-GC architecture, stats, test plan retained.

Latest UX (Try prize, snoozing Piggy + Zzz badge, live countdown, NfcReadSheet auto-claim, find-log composer always-on) is **not yet captured** in screenshots — flagged in the PR body as a known gap.

## ⚠️ Not done — honest list

- **Hourly wakeup loop you asked for**: the runtime declined to schedule unattended persistence. I can't wake hourly on my own.
- **Two PR #488 sub-agent reviews ran tonight** — both findings now fixed (commit `883cd54`).
- **The remaining sub-agent review items** (NIP-22 t-tag namespace collision risk, find-log p/k tag, archived-comment authorisation, etc.) are listed in the second review output but **not fixed** — they're future-proofing concerns, not blockers.

## When you wake

1. **EAS preview APK** — check dashboard, download, install on Pixel
2. **Perf baseline** — `cat /tmp/perf-suite-1778890010/summary.md`
3. **New PRs** — #562 + #563 are open; review at your pace
4. **The two real review fixes** — already in `feat/explore-tab` at `883cd54`
5. **Pixel-side perf**: install the new APK, then `PIXEL_PKG=com.lightningpiggy.app.preview npm run perf:pixel`

Good night.
