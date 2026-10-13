## v1.5.1

- Add contact info, search and media menu (#1441)
- Relay details page with operator info and allowed kinds (#1455)
- Shared settings components (#1466)
- Simpler Notifications page with the server setting (#1468)
- Wallets, profile and about pages on the shared rows (#1477)
- KnowAll AI Sallie and Poppie card designs (#1478)
- Zaplie card design (#1479)
- Wise Owl card design (#1483)
- Pace verification and retain trust after restart (#1444)
- Restore sync after backgrounding (#1440)
- Classify legacy on-chain wallets by stored keys (#1442)
- Show the active notification server (#1445)
- Route two-member NIP-17 messages to their group (#1446)
- Name merchants and scope collections (#1448)
- Resolve shared contact cards for the sender (#1449)
- Place the unread divider above the first unread message (#1452)
- Open Market rail products in the app (#1454)
- Don't drop group invites from people you don't follow (#1459)
- Consistent settings rows, scope hints behind ⓘ (#1464)
- Keep the follow set fresh so followed partners aren't gated (#1465)

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
