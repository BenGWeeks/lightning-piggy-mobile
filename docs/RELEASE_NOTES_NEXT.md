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

- **Notifications screen.** A bell on Home shows unread alerts; tap it to see the last 30 days of messages, payments, zaps and Piglet finds, open any of them, or mark all as read.
- **Clearer relay settings.** Account → Nostr now leads with Your relays and DM inbox relays, each showing a live connection dot; app defaults and geo-cache relays sit under Advanced.
- **Backup image servers.** Account → Nostr → Image servers (Blossom): add backup servers and pick a primary. Uploads switch to a backup if the primary is down and are copied to the others. Publish shares the list with other Nostr apps.
- **Marmot messaging (Alpha)** — end-to-end encrypted MLS chats that work with White Noise. Pick _Marmot_ when starting a chat or creating a group; every message type works between Lightning Piggy users, including photos, voice notes, polls and invoices. With White Noise, photos, GIFs, polls and emoji reactions show up on both sides (photos in chats started from this version on); voice notes don't play there yet, and invoices and locations appear as plain text. If someone can't receive Marmot yet — for example on the classic White Noise app — your message is sent with NIP-17 instead and the chat switches over. Invites from people you follow (e.g. on White Noise) are accepted automatically and open as Marmot chats. Friends on White Noise get a notification on their phone when you message them over Marmot. Still being tested, so use NIP-17 for anything important.
- **Marmot push notifications (opt-in).** Account → Security → Push notifications → _Marmot messages_ lets Lightning Piggy and White Noise users wake your phone when they message you in a Marmot chat, even with the app closed. Off by default, and set per account: other accounts on the same phone never inherit it, and you're warned if one already uses push, because people who chat with both could tell they share a phone. Every push just says "New message" — Apple/Google never see what it says, and tapping it opens Messages. Needs Google Play services on Android. With Amber or a remote signer, approve one signature per chat.
- **More push notifications (opt-in).** With push on, Account → Security → _More push notifications_ adds separate switches for Messages, Zaps, Mentions and Payments, so Lightning Piggy can tell you about them even when the app is closed. Each is off by default. Alerts are generic ("New message", "Zap received"…). Lightning Piggy's notification server learns your public key (and, for Payments, your wallet connections' keys) and when something arrives; it can't read your messages or wallet activity. It can't tell a payment you received from one you sent. Your relays can see our server watching your key. With Amber or a remote signer, approve one signature when you change these, and about once a week to keep them active.

### Improved

- **Message alerts open that conversation**, even ones that arrived while the app couldn't read them yet, instead of just the Messages list.
- **Opening a chat clears its alerts**, so the dot on the app icon goes away.
- **Group chats show their NIP-17 tag**, like one-to-one chats.
- **Copy a message's text and react with more emoji.** Long-press a text message in a one-to-one chat for _Copy text_, or tap _+_ beside the quick reactions for more emoji.

### Fixed

- **Relay dots show the real connection status** instead of always red.
