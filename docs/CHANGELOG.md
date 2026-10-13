## v1.5.0

- **Sell your own items.** Market → **My shop**: shop details, collections (e.g. "3D prints"), shipping and listings with photos, prices and stock. New sellers are guided to their first item.
- **Marmot messaging (Alpha).** End-to-end encrypted chats that work with White Noise: photos, voice notes, GIFs, polls, reactions, Reply, edits and deletes, in 1:1s and groups. Group admins, @mentions with a jump badge, and an _Unread messages_ divider. Use NIP-17 for anything important.
- **Your devices.** Invites reach every device a contact uses. Tap _Secure chat · N devices_ to see them; message info shows the sending device.
- **Live location** in chats. On Android it keeps sharing while minimised, with an ongoing notification and **Stop sharing**.
- **Push notifications (opt-in).** Account → Security: Marmot messages can wake a closed app. Mute any sender from their notifications.
- **Profile tabs:** Posts, Media and Shop, with a _Posts | Posts & replies_ switch. Replies from other apps (NIP-22) show too.
- **Six new languages:** Deutsch, Magyar, Polski, हिन्दी, मराठी and 中文（简体）, chosen per account.
- **Explore:** View on BTC Map, with a business's phone and website, and Preferred Sellers from accounts Lightning Piggy follows.
- **Faster:** chats open quicker (no more repeated inbox refreshes), reactions show straight away, the Explore map loads fast and the Market remembers your filters.
- **Group chats** show sender pictures (tap one for their profile) and softer pink-to-purple bubbles.
- **Wallets tab** (renamed from Home): each wallet's transactions show instantly when you swipe between wallets, and wallet buttons never stay faded.
- **Tidier settings and drawer:** Display & language combined; Messages, Notifications and Advanced split out; no scrolling in the drawer.
- **Safer links:** previews, images and voice notes from people you don't follow wait for a tap.
- Catching up on a Marmot group no longer loses older messages, and White Noise stays in groups after a rename or admin change.
- No more phantom or nameless "New message" alerts.
- Messages, listings and invites that no relay accepted are no longer shown as sent.
- The app no longer hangs after a swap completes. There's no default swap server now: set your own under Account → On-chain.
- Corrupted invoices are rejected before paying, and sharing your location asks first.

## v1.4.1

- **Notifications screen.** A bell on Home shows unread alerts; tap it to see the last 30 days of messages, payments, zaps and Piglet finds, open any of them, or mark all as read.
- **Clearer relay settings.** Account → Nostr now leads with Your relays and DM inbox relays, each showing a live connection dot; app defaults and geo-cache relays sit under Advanced.
- **Backup image servers.** Account → Nostr → Image servers (Blossom): add backup servers and pick a primary. Uploads switch to a backup if the primary is down and are copied to the others. Publish shares the list with other Nostr apps.
- **Message alerts open that conversation**, even ones that arrived while the app couldn't read them yet, instead of just the Messages list.
- **Opening a chat clears its alerts**, so the dot on the app icon goes away.
- **Group chats show their NIP-17 tag**, like one-to-one chats.
- **Relay dots show the real connection status** instead of always red.
- **Marmot group invites** (e.g. from White Noise) now say "not supported yet" instead of showing unreadable text.

## v1.4.0

- **Market in Explore.** Browse Lightning Piggy vendors and their products, filter by country, currency or merchant, read reviews, and check out in-app — pick shipping, place the order and pay the invoice. Listings from your friends now load live.
- **Edit your public relay lists.** Account → Nostr → **Published relay lists**: add or remove relays for your Nostr relay list and your DM inbox, then **Publish**. Shows which relays accepted it.
- **Pick the message type per chat.** Conversations are tagged NIP-04 or NIP-17, and you can choose which to use when starting a new chat.
- **Scan a Lightning voucher to claim it.** Receive → scan an LNURL-withdraw QR to pull the sats into your wallet.
- **Tidier map.** Nearby geo-caches and merchants group into count bubbles until you zoom in, and caches load for wherever you pan.
- **Swap server settings.** Use your own swap server, and test on-chain server connections from Settings.
- **Incoming swaps show as pending** straight away, and on-chain swap sends show roughly how long they'll take.
- **Android: payment notifications in the background** for NWC wallets, even when the app isn't open.
- **New messages that arrive while you're scrolled up** are flagged so you don't miss them.
- **Better screen-reader support** across buttons, switches and tabs.
- **Wallet settings → Design** now has a Save button.
- **Failed incoming swaps can be refunded** even when the app hadn't recorded which wallet they were for.
- **Safer swaps and payments:** swaps are checked before funding, and invoices must match the amount you approved.
- **The keyboard no longer hides text boxes** near the bottom of Account screens on Android.
- Your Piglets refresh when you return to the map, and the camera permission prompt works the first time you open Send.
- Supports newer Android phones that use 16 KB memory pages.
