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

- **Sell your own items.** Market → **My shop**: shop details, collections (e.g. "3D prints"), shipping and listings with photos, prices and stock. New sellers are guided to their first item.
- **Marmot messaging (Alpha).** End-to-end encrypted chats that work with White Noise: photos, voice notes, GIFs, polls, reactions, Reply, edits and deletes, in 1:1s and groups. Group admins, @mentions with a jump badge, and an _Unread messages_ divider. Use NIP-17 for anything important.
- **Your devices.** Invites reach every device a contact uses. Tap _Secure chat · N devices_ to see them; message info shows the sending device.
- **Live location** in chats. On Android it keeps sharing while minimised, with an ongoing notification and **Stop sharing**.
- **Push notifications (opt-in).** Account → Security: Marmot messages can wake a closed app. Mute any sender from their notifications.
- **Profile tabs:** Posts, Media and Shop, with a _Posts | Posts & replies_ switch. Replies from other apps (NIP-22) show too.
- **Six new languages:** Deutsch, Magyar, Polski, हिन्दी, मराठी and 中文（简体）, chosen per account.
- **Explore:** View on BTC Map, with a business's phone and website, and Preferred Sellers from accounts Lightning Piggy follows.

### Improved

- **Faster:** chats open quicker (no more repeated inbox refreshes), reactions show straight away, the Explore map loads fast and the Market remembers your filters.
- **Group chats** show sender pictures (tap one for their profile) and softer pink-to-purple bubbles.
- **Wallets tab** (renamed from Home): each wallet's transactions show instantly when you swipe between wallets, and wallet buttons never stay faded.
- **Tidier settings and drawer:** Display & language combined; Messages, Notifications and Advanced split out; no scrolling in the drawer.
- **Safer links:** previews, images and voice notes from people you don't follow wait for a tap.

### Fixed

- Catching up on a Marmot group no longer loses older messages, and White Noise stays in groups after a rename or admin change.
- No more phantom or nameless "New message" alerts.
- Messages, listings and invites that no relay accepted are no longer shown as sent.
- The app no longer hangs after a swap completes. There's no default swap server now: set your own under Account → On-chain.
- Corrupted invoices are rejected before paying, and sharing your location asks first.
