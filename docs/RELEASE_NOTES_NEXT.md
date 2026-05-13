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

- Fix: cold-start "Send button feels frozen for ~12 s" is gone — tap Send the moment Home appears and the bottom sheet opens within ~1 s on real hardware. Same for Receive and Transfer.
- Fix: sending a GIF (or text, image, location, contact, invoice) in a 1:1 conversation no longer disappears when you tap back and reopen the chat — the bubble persists immediately, and dedups cleanly when the relay echo lands.
- Perf: fiat balance (GBP / USD / etc.) renders on cold start from cache instead of being blank for 1-3 s while the BTC price fetch round-trips.
- Perf: Nostr profile + relay list hydrate from cache on first paint, so own avatar + name appear in the drawer immediately instead of waiting on a relay round-trip.
- Perf: messages tab populates faster on cold start — wrap-ID dedup carries across the live-DM sub re-open so the relay re-stream doesn't re-decrypt + re-route everything it already saw.
- Perf: outgoing zap counterparty names + avatars resolve in a single batched relay round-trip instead of one query per transaction — fixes the multi-second JS-thread freeze when the transaction list has many unresolved senders.
