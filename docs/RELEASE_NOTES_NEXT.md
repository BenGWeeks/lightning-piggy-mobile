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

- New: **Explore tab** replaces Learn. The hub surfaces four rails — Map (Bitcoin merchants near you, powered by BTC Map), Geo-caches (hide a Piglet → finders claim sats by tapping an NFC tag or scanning a QR), Events (Bitcoin meetups near you, NIP-52), and Lessons (the existing course content).
- New: **Map** sub-screen shows Lightning-accepting (pink) and on-chain (orange) merchants within a 50 km window with a search bar, distance sort, and a tap-through to merchant detail with directions / Pay actions.
- New: **Hide a Piglet** — paste any LNURL-withdraw, drop a hint photo and a GPS pin, and write to an NTAG213/215/216 or Mifare Ultralight C NFC tag. The tag is locked read-only after write on Android (iOS writes unlocked).
- New: **Geo-caches** list shows your own hidden Piglets + nearby public caches (NIP-GC kind 37516) interop-compatible with treasures.to. Tap a row → detail screen with hint, hint photo, and a Claim button if you have a tag in range.
- New: **Events** sub-screen surfaces NIP-52 calendar events near you with a 5km / 25km / 150km / 500km / All distance chip row. UP NEXT highlights the next three.
- New: **Web-of-Trust filter** — Geo-caches and Events default to showing publishers in your Nostr follows + their friends. Toggle off in Account → Web of Trust.
- New: opt-in **Nearby Bitcoin merchants** notifications — background geofence alerts when you walk near a Lightning- or Bitcoin-accepting shop. Off by default; configure radius + quiet hours in Account → Nearby merchants.
- Fix (iOS): Lightning Piggy no longer captures every `lightning:` link system-wide. Bolt11 invoices and LNURL-pay links open in your default LN wallet again. LP still handles `lightning:lnurl…` withdraw URIs (the Hunt finder flow).

- New: confirmation prompt before any Lightning send or wallet transfer at or above 10,000 sats. Threshold is configurable (Off / 1k / 10k / 100k / Custom) under Account → Security.
- New: friends-profile sheet now shows the friend's npub QR code, a "Copy lud16" button, and a "Write to NFC tag" affordance directly on the bottom sheet.
- Polish: amount-entry SATS↔fiat swap is now a bright pink pill with a white arrow instead of a small grey arrow — much easier to tap.
- Fix: outgoing payments now record the counterparty correctly — sent zaps show the friend's avatar and name in the conversation thread.
- Fix: Amber-signed NIP-17 group messages now send end-to-end (raw-JSON Intent encoding fix; was breaking kind-13 seals).
- Fix: "Type message" composer in conversations no longer briefly jumps to the top of the screen on first open.
- Fix: action row on the friends-profile sheet no longer overflows on narrower phone screens.
- Fix: cold-start "Send button feels frozen for ~12 s" is gone — tap Send the moment Home appears and the bottom sheet opens within ~1 s on real hardware. Same for Receive and Transfer.
- Fix: sending a GIF (or text, image, location, contact, invoice) in a 1:1 conversation no longer disappears when you tap back and reopen the chat — the bubble persists immediately, and dedups cleanly when the relay echo lands.
- Perf: slow Lightning payments (e.g. via Boltz/RBTC swaps that take 30–90 s to settle) no longer mis-report as failed — wait extends to 90 s with an honest "still in flight" message; the conversation bubble only turns red on a definitive failure.
- Perf: Lightning-zap sender avatars render instantly on cold start instead of waiting for a relay round-trip.
- Perf: home wallet card clears the "Disconnected" indicator noticeably faster on cold app launch.
- Perf: avatar grids no longer hit a decode-error storm when a contact has an unsupported image URL (`.svg` / `.heic`).
- Perf: fiat balance (GBP / USD / etc.) renders on cold start from cache instead of being blank for 1-3 s while the BTC price fetch round-trips.
- Perf: Nostr profile + relay list hydrate from cache on first paint, so own avatar + name appear in the drawer immediately instead of waiting on a relay round-trip.
- Perf: messages tab populates faster on cold start — wrap-ID dedup carries across the live-DM sub re-open so the relay re-stream doesn't re-decrypt + re-route everything it already saw.
- Perf: outgoing zap counterparty names + avatars resolve in a single batched relay round-trip instead of one query per transaction — fixes the multi-second JS-thread freeze when the transaction list has many unresolved senders.
