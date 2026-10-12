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

- **Sell your own items.** Market → **My shop** (store icon): set up shipping options, then list items with photos, price, stock, categories and a Markdown description. Edit, preview or delete them any time.
- **Profile tabs.** Profiles have **Posts**, **Media** and **Shop** tabs and a _Posts | Posts & replies_ switch. Mentions and shared notes show as tappable names and cards.
- **Six new languages:** Deutsch, Magyar, Polski, हिन्दी, मराठी and 中文（简体）. Pick one per account in Account → Display & language.
- **Marmot messaging (Alpha)** — end-to-end encrypted chats that work with White Noise. Pick _Marmot_ when starting a chat or creating a group. Photos, voice notes, GIFs, polls and reactions work with White Noise (invoices and locations show there as plain text), and you can edit or delete your own messages. Invites reach all of a friend's apps. If someone can't receive Marmot yet, you're asked before it goes over NIP-17. Still being tested, so use NIP-17 for anything important.
- **Marmot group admins.** See who the admins are and make others admins; only admins can rename a group or change its members.
- **See someone's devices in Marmot chats.** A Marmot one-to-one shows _Secure chat · 2 devices_ under the name when the other person is on several devices; tap it, or _N devices_ under a person in a group's members list, to see each device and which app it is. Tapping a message's time shows which device sent it, where that can be told.
- **Devices that can get new chats.** Account → Messages lists each device people can start a private chat with. Refresh this phone, or remove devices you no longer use.
- **Marmot push notifications (opt-in).** Account → Security → Push notifications → _Marmot messages_ wakes your phone for Marmot chats, even with the app closed. Off by default and per account; every push just says "New message". Needs Google Play services on Android.
- **More push notifications (opt-in).** With push on, separate switches for Messages, Zaps, Mentions and Payments. Alerts are generic and never show what was sent.
- **Back up your key before signing out.** Signing out of a local-key account now warns you and offers a backup.

### Improved

- **Wallets tab.** The Home tab is now **Wallets**, and the drawer's wallet settings are **Manage wallets**. Swiping between wallets shows the right transactions instantly.
- **Tidier settings.** Display and language are combined; Messages, Notifications and Advanced have their own screens. Language, currency and safety settings are per account.
- **Market:** edit or delete your own comments and reviews, pull to refresh product pages, and friends' listings load faster.
- **Safer links in chats and profiles.** Link previews, images and voice notes from people you don't follow wait for a tap before loading, and nothing loads from private network addresses.
- **Unreachable relays are skipped**, so a dead relay no longer slows the app down.
- **Copy a message's text and react with more emoji.** Long-press a text message in a one-to-one chat.

### Fixed

- **No default swap server any more.** Boltz's public server has shut down, so swaps through a Lightning wallet need your own: Account → On-chain → _Swap server URL_. Sends straight from an on-chain wallet don't need one.
- **On-chain Send explains why it's disabled** (fees not loaded, or balance too low) and offers _Retry fees_.
- **White Noise stays in Marmot groups** after a rename or admin change.
- **No more phantom or nameless "New message" alerts.**
- **A message, listing or invite that no relay accepted is no longer shown as sent.**
- **Corrupted invoices are rejected** before paying, and sharing your location asks first.
- **Wallet is visible but disabled in group chat attachments.**
- **Signer declines stop the inbox refresh** instead of asking again for every message.
