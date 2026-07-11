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

- **Hunt community sections.** The Geo-caches screen now shows "Recently added" and "Recently found" rails, plus a Leaderboard page (top hiders and top finders) — Explore → Geo-caches → scroll down.
- **Cover-flow card picker.** Wallet Settings → Card Design is now a swipeable cover-flow of all card themes.
- **AI Robot wallet card.** A new chrome-and-green robot design in the card picker.

### Improved

- Settings screens (Security, On-chain, Nearby merchants) now use white section icons and brand-pink toggles and selected rows.
- Home feels snappier — wallet refreshes that change nothing no longer rebuild the transaction list.
- Explore map pans more smoothly (marker layers no longer re-render on every GPS fix).
- Group messages appear in the thread instantly when you hit send.

### Fixed

- Tapping a sent group message no longer shows a false "Send failed" dialog — delivered messages now read "Message sent".
- Geo-caches hidden in Lightning Piggy now always show the Piglet icon and pink map pin, even when they have no prize attached (existing caches fix themselves, no republish needed).
- The app responds to taps immediately after waking from a long background pause.
