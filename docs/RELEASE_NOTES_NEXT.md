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

### New

- **One-tap CoinOS wallet** — first-time users with no wallet get a "Create Lightning Wallet" tile in the Add Wallet sheet that auto-provisions a managed CoinOS account and connects it via NWC. The recovery sheet that follows is mandatory and shows your username + password behind a masked reveal, so save them somewhere safe before continuing.
- **Relay list editor** — Account → Nostr now lets you add and remove relays in-app. Each row shows live read/write state and a connection dot; your edits merge cleanly with your NIP-65 list and the app defaults.
- **Copyable NWC connection string** — Wallet Settings on any NWC wallet now exposes the connection string (masked behind an eye toggle) with a QR overlay, so you can move a wallet to another NWC client without losing access.
- **Live location dot on every map** — Explore, the full Map, Places, Geo-caches, Hunt and merchant detail now follow your real position as you move, with an accuracy halo that tightens as the GPS warms up. Works on de-Googled devices and stock emulator images (no Google Play Services needed).
- **Edit a Piglet from a second phone** — log into your Nostr identity on a new device and your hidden Piglets show up in My Piglets, editable there (hint, expiry, …) even though the original record was created on the first phone.
- **Tap a profile photo to view it full-screen**, with pinch-to-zoom. The quick-profile sheet is also slimmer and keeps a consistent height.
- **Add-contact celebration** — adding a friend now shows a brief celebration confirming it worked.
- **Tappable links in messages** — URLs in chat now open in your browser instead of being plain text.
- **Names + avatars for non-friend DM senders** — people you're not following now resolve to their Nostr name + avatar instead of a bare npub.

### Improved

- Conversation and Friends rows now paint display name + avatar from cache on cold start, instead of briefly showing a truncated npub + grey silhouette.
- Friend rows always show the zap + message icons (greyed out when not usable), so the row layout no longer jumps.
- Offline banner appears at the top when connectivity drops, and clears when it returns.
- Fiat row shows "£–" instead of a blank/stale value when the BTC price is briefly unavailable, and retries the price fetch when you reopen the app.
- The app restores the tab + sub-screen you were on across a cold start, instead of always landing on Home.
- Bigger, easier-to-tap alphabet bar on the Friends list; accented names (e.g. "Loïc") now sort under the right letter.
- Web-of-Trust filter on Explore defaults to "all"; nearby merchant/cache detail now opens in a sheet, and a geohash-neighbour fix stops nearby items being missed at tile edges.
- Wider merchant search radius — 100 km for nearby, 200 km for boosted merchants.
- Smoother, faster maps: Explore opens without the long tab-switch freeze, the full Map no longer flashes at mini-map size for a frame, and the accuracy halo scales correctly with zoom.
- Home balance refreshes every 10 s (was 30 s) so incoming payments show sooner — without the JS-thread freeze the old polling could cause.

### Fixed

- Sending no longer shows "Payment failed" on a mere relay/connection hiccup — the payment may well have gone through.
- No more phantom "received 1 sat" toast on app open — receipts are deduped by payment hash and seeded silently from history.
- The wallet no longer reconnects in a loop when a single relay goes offline.
- The Add-wallet card now shows the "add a wallet" prompt instead of the previous wallet's transactions.
- Invoices you create now carry a default "Sent with Lightning Piggy" memo instead of a blank description.
