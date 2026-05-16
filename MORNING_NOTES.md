# Morning notes — 2026-05-16

Everything you need to pick up where I left off.

## ✅ EAS preview APK — READY

- **Download:** https://expo.dev/artifacts/eas/iwDs59XEK3jYc8aVJv5URT.apk
- Build ID: `8df2bfd8-bc7f-46b2-b830-7c1ef53c450d`
- Commit at build kick-off: `c9d11d2` (does NOT include the perf or MapLibre branches — those need a fresh build to verify natively)
- Install: `adb -s 37111FDJH0067B install -r <downloaded.apk>` — should upgrade your existing preview install (same EAS upload keystore).
- Once installed, run `PIXEL_PKG=com.lightningpiggy.app.preview npm run perf:pixel` for a Pixel-side perf baseline.

## ✅ AVD perf baseline — captured

Source of truth: `/tmp/perf-suite-1778890010/summary.md` (commit it in if you want it tracked).

| Surface | Modern jank | Legacy jank | 99th frame | 4950ms hits |
|---|---:|---:|---:|---:|
| Home tab cold tap | 10.0% | 18.7% | 400 ms | 2.5 |
| **Messages tab cold tap** | **14.7%** | **47.5%** | **800 ms** | **6.0** ⚠️ |
| Friends tab cold tap | 9.6% | 10.0% | 425 ms | 1.0 |
| Explore tab cold tap | 10.6% | 13.2% | 625 ms | 1.5 |
| Friends list scroll | 100.0% | 0.0% | 16.5 ms | 0 |
| Messages list scroll | 66.7% | 0.0% | 16.0 ms | 0 |

5 of the 11 surfaces reported `n/a` — those Maestro flows still reference old testIDs (Places rail, Geo-caches rail, Geo-caches list cold, FAB → FriendPicker, Group → Back). Listed in #560 as a follow-up; they need testID refreshes before they can measure.

**Messages tab is the clear outlier** — 47.5% legacy jank + 800 ms p99 + 6 frames over 4950 ms confirms tonight's logged `refreshDmInbox: 8662ms` is still hitting hard. Most of the jank lives in the NIP-17 unwrap loop. PR #562 (NIP17_LOOP_YIELD_EVERY 4 → 2) directly targets this — re-run perf after merging to compare.

## ✅ New PRs opened against `feat/explore-tab`

| PR | Branch | Purpose | State |
|---|---|---|---|
| [#562](https://github.com/BenGWeeks/lightning-piggy-mobile/pull/562) | `perf/render-profiler-nip17-yield` | React.Profiler on Home + Explore + NIP-17 yield 4 → 2 | open |
| [#563](https://github.com/BenGWeeks/lightning-piggy-mobile/pull/563) | `feat/maplibre-native` | MapLibre Native scaffolding (#552 — replace Leaflet WebView) | **draft** |

## ✅ Shipped on `feat/explore-tab` while you slept

| Hash | What |
|---|---|
| `883cd54` | Two findings from PR #488 sub-agent review (fetchCache/fetchEvent maxWait + piggyStorage expiresAt) |
| `b77e63f` | Merge PR #548 — three-tier WoT chip for Messages |
| `1d5778c` | Merge PR #550 — Places rail cold-start paint |
| `33f65c5` | Merge PR #551 — Leaflet bridge refactor |
| `08ef469` | Try prize button hidden when no sats advertised |
| `c9d11d2` | popToTop on Explore tab tap (StackActions, prior `navigate()` was a no-op when already focused) |
| `fc4ffe1` | Comment refresh on `test-explore-tab-rename.yaml` to match rails layout |

PRs #556 + #557 were already cherry-picked into the branch earlier in the session — code is there, no separate merges.

## ✅ PR #488 description

Rewritten as a single 30-cell, 3-column screenshot table per your spec. Earlier multi-table layout is gone. Summary, NIP-GC architecture, stats, and test plan retained.

Latest UX (Try prize, snoozing Piggy + Zzz badge, live countdown, NfcReadSheet auto-claim, find-log composer always-on) is **not yet captured** in screenshots — flagged in the PR body as a known gap to sweep with fresh emulator screenshots.

## ⚠️ Honest gaps

- **Hourly self-wake loop** — runtime declined to schedule unattended persistence. Couldn't keep poking through the night.
- **Five Maestro flows still time out** because of stale testIDs (the rails-redesign blast radius wasn't fully cleaned up). Documented in #560.
- **Pixel-side perf** requires the new APK installed first — that's your morning move.
- **Latest UX screenshots** for PR #488 still pending.
- **Open review items not fixed** from the second sub-agent pass on #488: NIP-22 t-tag namespace collision risk, find-log p/k tags, archived-comment authorisation. Future-proofing concerns, none blocking.

## When you wake — recommended order

1. **Install the preview APK** on the Pixel (link above)
2. **Pixel perf baseline:** `PIXEL_PKG=com.lightningpiggy.app.preview npm run perf:pixel` — gives you the real-device numbers
3. **Review PR #562** — should land first; it's a small change with direct perf impact (especially on the Messages tab freeze)
4. **Glance at PR #563** — draft because it needs a native rebuild to verify. When you're ready to verify, `npx expo prebuild --clean && npx expo run:android` will produce a dev client with the MapLibre native module wired.
5. **PR #488 itself** — clean description with the single screenshot table. Ready to be marked ready-for-review once tonight's UX screenshots are captured.

Good morning.
