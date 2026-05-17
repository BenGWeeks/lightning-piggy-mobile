<!--
Append a one-line bullet describing your user-visible change in the same PR.
Each release, the contents of this file are auto-published to TestFlight as
the "What to Test" notes for that build, then the file is reset.

- Keep bullets short, written for a tester, not a developer.
- Only user-visible changes belong here; pure refactors / CI / docs do not.
- Empty file = release workflow falls back to `git log` subjects since the last tag.

See docs/DEPLOYMENT.adoc → "TestFlight 'What to Test' automation".
-->

## What to test in the next release

- New: **One-tap CoinOS wallet** — first-time users with no wallet get a "Create Lightning Wallet" tile in the Add Wallet sheet that auto-provisions a managed CoinOS account, generates a username + password, and connects via NWC. The recovery sheet that follows is mandatory and shows the credentials behind a masked reveal so you can copy them somewhere safe before continuing.
- New: **Relay list editor** — Account → Nostr now lets you add and remove relays directly in-app. Each row shows live read/write state and a green-dot connection indicator that updates every 3 s; user-added rows merge cleanly with your NIP-65 list and the app defaults.
- New: **NWC connection string** is now copyable from Wallet Settings on every NWC wallet (not just CoinOS) — masked behind an eye toggle by default, with a QR overlay so you can scan it from another NWC client to move the wallet across devices without losing access.
- New: **Edit a Piglet from a second phone** — if you log into your Nostr identity on a new device, your hidden Piglets show up in My Piglets and you can edit them there (hint, expiry, etc.) even though the local record was created on the original phone.
- Fix: outgoing Lightning payments now default the description to "Sent with Lightning Piggy" so the receiver sees a friendly label instead of a blank memo.
- Fix: **navigation state persists across cold starts** — kill the app, reopen, and you land back on the same tab + sub-screen you left, instead of always landing on Home.
- Perf: home wallet balance refresh tightened from 30 s → 10 s while the Home tab is visible, so an incoming payment shows up much faster.
- New: **Live user-location dot** across every map (Explore hub, full Map, Places, Geo-caches, Hunt and merchant detail). The dot now follows your real position as you walk, with a translucent accuracy halo that shrinks as the GPS warms up — indoors it'll be a wide circle, step outside and it tightens to ~5 m within seconds. Camera glides smoothly into the new location every ~15 s or 20 m instead of hard-cutting. Works on de-googled devices and stock emulator images too (no longer needs Google Play Services for location).
- New: **Geographic GPS accuracy halo** — the blue circle around your dot is now a real geographic radius drawn at your reported accuracy in metres, so it scales with the map's zoom (Google-Maps-style) instead of being a fixed pixel size. Zoom out and the halo shrinks visually as it should.
- Fix: opening the full Map no longer flashes the map at mini-map size for one frame before expanding to full-screen.
- Fix: dismissing a merchant or geo-cache detail sheet on the Map no longer flashes the sheet back to full-size for one frame before disappearing.
- Perf: Explore tab no longer fires a render storm when Nostr relay batches roll in — the per-event setState bursts are now coalesced, dropping a multi-hundred-millisecond JS-thread block on busy relays.
