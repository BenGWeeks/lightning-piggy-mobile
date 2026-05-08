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

- New: pick a fiat currency from a searchable list of 38 (USD/EUR/GBP pinned at the top; DKK, KRW, CNY, INR and more supported). Account → Currency.
- New: confirmation prompt before any Lightning send or wallet transfer at or above 10,000 sats. Threshold is configurable (Off / 1k / 10k / 100k / Custom) under Account → Security.
- New: friends-profile sheet now shows the friend's npub QR code, a "Copy lud16" button, and a "Write to NFC tag" affordance directly on the bottom sheet.
- Polish: amount-entry SATS↔fiat swap is now a bright pink pill with a white arrow instead of a small grey arrow — much easier to tap.
- Fix: outgoing payments now record the counterparty correctly — sent zaps show the friend's avatar and name in the conversation thread.
- Fix: Amber-signed NIP-17 group messages now send end-to-end (raw-JSON Intent encoding fix; was breaking kind-13 seals).
- Fix: "Type message" composer in conversations no longer briefly jumps to the top of the screen on first open.
- Fix: action row on the friends-profile sheet no longer overflows on narrower phone screens.
- Perf: slow Lightning payments (e.g. via Boltz/RBTC swaps that take 30–90 s to settle) no longer mis-report as failed — wait extends to 90 s with an honest "still in flight" message; the conversation bubble only turns red on a definitive failure.
- Perf: Lightning-zap sender avatars render instantly on cold start instead of waiting for a relay round-trip.
- Perf: home wallet card clears the "Disconnected" indicator noticeably faster on cold app launch.
- Perf: avatar grids no longer hit a decode-error storm when a contact has an unsupported image URL (`.svg` / `.heic`).
