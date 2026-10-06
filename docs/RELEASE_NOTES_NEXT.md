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

- **Market in Explore.** Browse Lightning Piggy vendors and their products, filter by country, currency or merchant, read reviews, and check out in-app — pick shipping, place the order and pay the invoice. Listings from your friends now load live.
- **Edit your public relay lists.** Account → Nostr → **Published relay lists**: add or remove relays for your Nostr relay list and your DM inbox, then **Publish**. Shows which relays accepted it.
- **Pick the message type per chat.** Conversations are tagged NIP-04 or NIP-17, and you can choose which to use when starting a new chat.
- **Scan a Lightning voucher to claim it.** Receive → scan an LNURL-withdraw QR to pull the sats into your wallet.
- **Tidier map.** Nearby geo-caches and merchants group into count bubbles until you zoom in, and caches load for wherever you pan.
- **Swap server settings.** Use your own swap server, and test on-chain server connections from Settings.

### Improved

- **Incoming swaps show as pending** straight away, and on-chain swap sends show roughly how long they'll take.
- **Android: payment notifications in the background** for NWC wallets, even when the app isn't open.
- **New messages that arrive while you're scrolled up** are flagged so you don't miss them.
- **Better screen-reader support** across buttons, switches and tabs.
- **Wallet settings → Design** now has a Save button.

### Fixed

- **Failed incoming swaps can be refunded** even when the app hadn't recorded which wallet they were for.
- **Safer swaps and payments:** swaps are checked before funding, and invoices must match the amount you approved.
- **The keyboard no longer hides text boxes** near the bottom of Account screens on Android.
- Your Piglets refresh when you return to the map, and the camera permission prompt works the first time you open Send.
- Supports newer Android phones that use 16 KB memory pages.
