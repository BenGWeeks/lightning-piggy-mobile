# Morning notes — 2026-05-16

What's running unattended overnight + what you'll find when you check.

## 🟡 EAS preview build (Android) — in progress

- Build ID: `8df2bfd8-bc7f-46b2-b830-7c1ef53c450d`
- Profile: `preview` · platform: `android`
- Commit: `c9d11d2` (popToTop fix, latest on `feat/explore-tab`)
- Dashboard: https://expo.dev/accounts/bengweeks/projects/lightning-piggy-app/builds/8df2bfd8-bc7f-46b2-b830-7c1ef53c450d
- Expected ready: ~01:25 UTC (started 01:06)
- **To install on Pixel:** download the APK from the dashboard, `adb -s 37111FDJH0067B install -r <file>.apk`. Should upgrade your existing preview install (same EAS upload keystore).

## 🟡 Perf-suite baseline (AVD) — in progress

- Output: `/tmp/perf-suite-1778890010/summary.md`
- Samples: 2 each across 8 surfaces (Home, Messages, Friends, Explore tabs + Explore-places, Explore-caches, Hunt-list, Friends-scroll)
- Live log: `/tmp/perf-run.log`
- Captures legacy-jank + p99 frame time so you can compare against the previous baseline
- ⚠️ Caveat: some Maestro flows reference legacy testIDs (`explore-card-*` still works on rails' "See all" buttons, so most should pass; the `test-explore-tab-rename` flow needs a comment-only refresh per CLAUDE.md note)

## ✅ Tonight's shipped commits on `feat/explore-tab`

| Hash | What |
|---|---|
| `883cd54` | Two findings from PR #488 sub-agent review (fetchCache/fetchEvent maxWait + piggyStorage expiresAt) |
| `b77e63f` | Merge PR #548 — three-tier WoT chip for Messages |
| `1d5778c` | Merge PR #550 — Places rail cold-start paint |
| `33f65c5` | Merge PR #551 — Leaflet bridge refactor |
| `08ef469` | Try prize hidden when no sats advertised |
| `c9d11d2` | popToTop on Explore tab tap (uses StackActions, prior `navigate(...)` was a no-op when already focused) |

PRs #556 + #557 were already cherry-picked into the branch earlier, so they're not separate merge commits but the code is there.

## ✅ PR #488 description

Rewrote into one 30-cell, 3-column screenshot table per your spec. The earlier multi-table layout is gone. Summary, NIP-GC architecture, stats, test plan retained.

Latest UX (Try prize button, snoozing Piggy + Zzz badge, live countdown, NfcReadSheet auto-claim, find-log composer always-on) is **not yet captured** in screenshots — would need a fresh emulator screenshot pass tomorrow. Noted in the PR body so reviewers know.

## ⚠️ Not done — be honest about it

- **Hourly wakeup loop you asked for**: the runtime declined to schedule an unattended cron/loop (auto-mode classifier blocked the persistent polling pattern). I can't wake hourly on my own — would need you to type `/loop` or kick me each time. The EAS build + perf-suite are one-shot background jobs that finish on their own, which is the closest substitute.
- **Maestro test-explore-tab-rename**: still failing because the test expects single-tap-to-cards but the screen is now rails. The testIDs survived so it's a comment-and-flow refresh, not a deep rewrite. Filed as a follow-up rather than fixed tonight.
- **Pixel preview perf**: can only happen AFTER you install the EAS APK. The baseline I captured tonight is on the AVD.

## When you wake

1. Check EAS dashboard — APK download link should be live by ~01:25
2. `adb install -r <apk>` on your Pixel
3. `cat /tmp/perf-suite-1778890010/summary.md` for the AVD baseline
4. If you want a Pixel-side run too: `npm run perf:pixel` (uses your prod cert; switch `PIXEL_PKG=com.lightningpiggy.app.preview` if needed)

Good night.
