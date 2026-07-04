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

- **Background message notifications (Android).** Turn on Account → Security → "Watch for messages in the background" and you'll get notified of new direct messages even when the app is closed or swiped away — no Google services needed. Only notifies for people you follow.
- **Choose your language.** Account → Appearance → Language now lets you pick Spanish or follow your device language. The bottom tab labels are translated so far; more screens follow.
- **Shop orders show as cards in your chats.** An order or receipt from a merchant now shows the item count, total in sats, and status — not raw text.
- **Pay an order in a tap.** Order cards have a Pay button and a QR code to pay the invoice from the chat, or scan it with another wallet.
- **Get notified when someone finds your Piglet.** Cache owners now get a notification when a finder logs a find on their cache.
- **Publish a cache with no prize.** You can now publish a geo-cache without attaching a Lightning reward.
- **See your swap on-chain.** Boltz swap details now link out to the mempool.space block explorer so you can follow confirmations.

### Fixed

- Typing fast into the Send address field no longer drops or duplicates characters.

### Improved

- Transaction history now scrolls smoothly through long histories instead of a "show all" button.
- Boltz swaps are hardened: the app verifies what the swap server returns before paying, and recovers stuck on-chain→Lightning swaps after a crash.
- Faster Messages tab load; smoother pink→purple theme accents.
- Fixed the amount keypad's "0" key being hidden behind the Android navigation bar.
