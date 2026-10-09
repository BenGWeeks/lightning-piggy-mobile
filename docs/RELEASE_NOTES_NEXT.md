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

### Improved

- **Message alerts open that conversation**, even ones that arrived while the app couldn't read them yet, instead of just the Messages list.
- **Opening a chat clears its alerts**, so the dot on the app icon goes away.
- **Group chats show their NIP-17 tag**, like one-to-one chats.
- **Marmot messaging (Alpha)** — end-to-end encrypted MLS chats that work with White Noise. Pick *Marmot* when starting a chat or creating a group; every message type works between Lightning Piggy users, including photos, voice notes, polls and invoices. With White Noise, photos, GIFs, polls and emoji reactions show up on both sides (photos in chats started from this version on); voice notes don't play there yet, and invoices and locations appear as plain text. If someone can't receive Marmot yet — for example on the classic White Noise app — your message is sent with NIP-17 instead and the chat switches over. Still being tested, so use NIP-17 for anything important.

### Fixed

- **Relay dots show the real connection status** instead of always red.
- **Marmot invites** (e.g. from White Noise) from people you follow are now accepted automatically and open as Marmot chats.
