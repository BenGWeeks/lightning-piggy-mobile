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

- **Sell your own items.** Market → **My shop**: set up shipping and listings with photos, prices and stock. Edit, preview or delete them.
- **Profile tabs.** **Posts**, **Media**, **Shop** and a _Posts | Posts & replies_ switch. Mentions and shared notes are tappable.
- **Six new languages:** Deutsch, Magyar, Polski, हिन्दी, मराठी and 中文（简体）. Pick one per account in Account → Display & language.
- **Marmot messaging (Alpha).** Encrypted chats with photos, voice notes, GIFs, polls, 1:1 reactions, edits and deletes. Group invites select up to 10 devices per person; new 1:1s prefer one White Noise device. White Noise support varies by version and protocol profile; GIF/poll interop is unconfirmed. NIP-17 fallback asks first. Use NIP-17 for anything important.
- **Marmot group admins.** View or appoint admins; only admins can rename groups or change members.
- **Marmot devices.** Tap _Secure chat · N devices_ in a 1:1 to see devices and apps. Message info identifies the sending device. Account → Messages lets you refresh this phone or remove old devices.
- **Push notifications (opt-in, per account).** Account → Security → Push notifications: Marmot messages can wake a closed app (Google Play services required on Android). Separate switches for Messages, Zaps, Mentions and Payments; alerts never show content.
- **Group @mentions.** Type _@_ to pick a member; an @ badge and jump button mark mentions of you. Chats reopen at an _Unread messages_ divider.
- **Local-key sign-out** warns first and offers a key backup.
- **Live location.** Android sharing continues while minimised, with an ongoing notification and **Stop sharing**. Marmot chats carry start, updates and end over Marmot only, without signer prompts for updates. iOS background sharing needs a newer build.

### Improved

- **Wallets tab.** Renamed from Home; wallet settings are **Manage wallets**. Swiping wallets shows the right transactions instantly.
- **Tidier settings.** Combined Display & language; separate Messages, Notifications and Advanced screens. Language, currency and safety settings stay per account.
- **Market:** edit or delete your own comments and reviews, pull to refresh product pages, and friends' listings load faster.
- **Safer links in chats and profiles.** Previews, images and voice notes from people you don't follow wait for a tap.
- **Unreachable relays are skipped** to avoid delays.
- **Copy a message's text and react with more emoji.** Long-press a text message in a one-to-one chat.

### Fixed

- **Catching up on a Marmot group no longer loses older messages** (#1356).
- **No default swap server any more.** Swaps through a Lightning wallet need your own: Account → On-chain → _Swap server URL_.
- **On-chain Send explains why it's disabled** (fees not loaded, or balance too low) and offers _Retry fees_.
- **White Noise stays in Marmot groups** after a rename or admin change.
- **No more phantom or nameless "New message" alerts.**
- **A message, listing or invite that no relay accepted is no longer shown as sent.**
- **Corrupted invoices are rejected** before paying, and sharing your location asks first.
- **Signer declines stop the inbox refresh** instead of asking again for every message.
