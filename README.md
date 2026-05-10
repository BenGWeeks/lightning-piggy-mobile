<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo.svg">
    <img alt="Lightning Piggy Mobile" src="assets/logo.svg" width="100%">
  </picture>
</p>

A mobile Bitcoin Lightning wallet built with Expo/React Native, connecting via Nostr Wallet Connect (NWC) with Nostr social features.

[![Figma Designs](image.png)](https://www.figma.com/proto/ROutnkBQtGGGzqi8yz0Maf/Lightning-Piggy?node-id=1-26&m=dev&scaling=scale-down&page-id=0%3A1&starting-point-node-id=19%3A519&show-proto-sidebar=1&t=P3MkR2W1YVSwtmIQ-1)

## Features

- Connect any Lightning wallet via NWC (Nostr Wallet Connect)
- On-chain Bitcoin wallets (watch-only via xpub, or hot wallets via mnemonic)
- Transfer funds between wallets (LN-to-LN, LN-to-on-chain, on-chain-to-LN, on-chain-to-on-chain)
- Send payments by scanning QR codes or pasting invoices
- Send to lightning addresses (user@domain) via LNURL-pay
- Send to on-chain addresses (BIP-21 URI support with amount)
- NIP-57 zaps to Nostr contacts
- Receive payments with QR code generation (optional amount for BIP-21)
- Real-time balance display with fiat conversion
- Transaction history
- Nostr identity login (nsec or Amber signer on Android)
- Friends tab with Nostr contacts and phone contacts
- Follow/unfollow Nostr contacts (kind 3 event publishing)
- Add friends by pasting npub or scanning QR code
- Contact profile cards with deep linking to Nostr apps
- QR code sharing for npub and Lightning address
- Secure credential storage (expo-secure-store)
- **Explore tab**: discover Bitcoin merchants nearby (BTC Map / OpenStreetMap),
  opt-in geofence alerts when you walk past one (#467), hunt for hidden
  LNURL-withdraw "Piggies" stashed on NFC tags or QR codes (#468), and find
  Bitcoin meetups (NIP-52 calendar events). Hunt Piggies adopt
  [treasures.to](https://treasures.to)'s **NIP-GC** (`kind 37516` listings,
  `kind 7516` found-logs, `kind 1111` NIP-22 comments) and tag the listing
  with a NIP-32 `com.lightningpiggy.app / payout-lnurl-w` label so LP renders the 🐷
  claim UX on top while generic geocaching clients render the cache normally.
  **The LNURL bearer token never goes on the public relay event** — it
  lives only on the physical NFC tag / QR (the access control) and in
  the hider's local SecureStore. Hider can update location / hint photo /
  cooldown / expiry by re-publishing with the same `d` tag (PRE
  semantics). See [docs/PROTOCOLS.adoc](docs/PROTOCOLS.adoc) →
  "Hunt: Lightning extension to NIP-GC" for the full tag schema.

## Standards

Lightning Piggy Mobile implements the following open standards. See [docs/STANDARDS.adoc](docs/STANDARDS.adoc) for usage details and source references.

### Bitcoin Improvement Proposals (BIPs)

| Standard                                                                  | Name                                    |
| ------------------------------------------------------------------------- | --------------------------------------- |
| [BIP-21](https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki)  | URI Scheme (`bitcoin:` with `?amount=`) |
| [BIP-32](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki)  | Hierarchical Deterministic Wallets      |
| [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)  | Mnemonic Seed Phrases                   |
| [BIP-84](https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki)  | Native SegWit HD Wallets (`bc1q...`)    |
| [BIP-327](https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki) | MuSig2 Schnorr Key Aggregation          |
| [BIP-340](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki) | Schnorr Signatures                      |
| [BIP-341](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki) | Taproot (SegWit v1)                     |

### Nostr Implementation Possibilities (NIPs)

| Standard                                                           | Name                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) | Basic Protocol (relays, events, subscriptions)                |
| [NIP-04](https://github.com/nostr-protocol/nips/blob/master/04.md) | Encrypted Direct Messages (legacy — inbound read only; outbound migrated to NIP-17 in #334) |
| [NIP-05](https://github.com/nostr-protocol/nips/blob/master/05.md) | DNS Identity Verification                                     |
| [NIP-14](https://github.com/nostr-protocol/nips/blob/master/14.md) | Subject Tag (used as group-chat name)                         |
| [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) | Private Direct Messages — canonical 1:1 and multi-recipient group chat (sealed via NIP-44 + gift-wrapped per recipient) |
| [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md) | Bech32-encoded Entities (`npub`, `nsec`)                      |
| [NIP-20](https://github.com/nostr-protocol/nips/blob/master/20.md) | Command Results (OK messages)                                 |
| [NIP-21](https://github.com/nostr-protocol/nips/blob/master/21.md) | `nostr:` URI Scheme                                           |
| [NIP-22](https://github.com/nostr-protocol/nips/blob/master/22.md) | Comments (kind 1111 — used by NIP-GC for DNF / maintenance / archived cache statuses) |
| [NIP-32](https://github.com/nostr-protocol/nips/blob/master/32.md) | Labels (`L` namespace + `l` value tags — used to mark Hunt caches as Lightning-payout via the `com.lightningpiggy.app / payout-lnurl-w` label) |
| [NIP-40](https://github.com/nostr-protocol/nips/blob/master/40.md) | Expiration Timestamp (auto-retire Hunt cache listings)        |
| [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md) | Encrypted Payloads v2 (used by NIP-17 sealing)                |
| [NIP-47](https://github.com/nostr-protocol/nips/blob/master/47.md) | Nostr Wallet Connect (NWC)                                    |
| [NIP-55](https://github.com/nostr-protocol/nips/blob/master/55.md) | Android Signer (Amber)                                        |
| [NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md) | Lightning Zaps                                                |
| [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) | Gift Wrap (used by NIP-17 to mask sender + metadata)          |
| [NIP-65](https://github.com/nostr-protocol/nips/blob/master/65.md) | Relay List Metadata                                           |
| [NIP-94](https://github.com/nostr-protocol/nips/blob/master/94.md) | File Metadata                                                 |
| NIP-GC ([draft, on Nostr](https://nostrhub.io/naddr1qvzqqqrcvypzppscgyy746fhmrt0nq955z6xmf80pkvrat0yq0hpknqtd00z8z68qqgkwet0vdskx6rfdenj6etkv4h8guc6gs5y5)) | Geocaching Events (kinds 37516 / 7516 / 1111 / 7517 — used by the Hunt feature, with an `com.lightningpiggy.app` NIP-32 label marker for Lightning-payout caches) |

Group state for client-side group chat is propagated via a parameterised-replaceable
`kind:30200` event (custom to this client; receivers reconcile by `groupId` + `created_at`).
Not a NIP — see `src/services/nostrService.ts` (`GROUP_STATE_KIND`) for the schema.

### LUDs (LNURL specifications)

| Standard                                                       | Name                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| [LUD-03](https://github.com/lnurl/luds/blob/luds/03.md)        | LNURL-withdraw — used by the Hunt feature to claim Piggies          |
| [LUD-16](https://github.com/lnurl/luds/blob/luds/16.md)        | Lightning Address (`user@domain` → LNURL-pay endpoint)              |
| [LUD-17](https://github.com/lnurl/luds/blob/luds/17.md)        | URI scheme prefixes (`lnurlw://`, `lnurlp://`, …) — accepted as input alongside bech32 `LNURL1…` |

### Lightning Standards

| Standard                                                                         | Name                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------ |
| [BOLT-11](https://github.com/lightning/bolts/blob/master/11-payment-encoding.md) | Lightning Invoice Encoding                 |
| [LNURL / LUD-16](https://github.com/lnurl/luds/blob/luds/16.md)                  | Lightning Address Protocol (`user@domain`) |

On top of these, Lightning Piggy Mobile uses the [Boltz v2](https://docs.boltz.exchange) submarine swap API for trustless Lightning ↔ on-chain transfers.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- An Android device or emulator
- A Lightning wallet that supports NWC (e.g. Alby, LNbits)

### Installation

```bash
git clone https://github.com/BenGWeeks/lightning-piggy-mobile
cd lightning-piggy-mobile
npm install
```

### Development

This project uses custom native modules (Amber signer), so it requires a dev client build rather than Expo Go.

```bash
# First time: build and install the dev client
npx expo run:android

# Subsequent runs: start Metro (connects to the dev client)
npm start

# Press 'a' to open on a connected Android device
```

> **Note:** Always use `npm start` (not `npx expo start`) — the start script includes `--dev-client` which is required for custom native modules. Using `npx expo start` directly will launch in Expo Go mode and show "Something went wrong".

### Environment variables

Optional keys are read from `.env` at the repo root (gitignored) and inlined into the bundle at build time via `app.config.ts` / Metro's `EXPO_PUBLIC_*` handling.

| Variable                    | Used by                    | Notes                                                                                                                                                                                                                                                                                                |
| --------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_GIPHY_API_KEY` | In-conversation GIF picker | Free key from [developers.giphy.com/dashboard](https://developers.giphy.com/dashboard/). Restrict it to the Android package / iOS bundle ID in the GIPHY dashboard — keys are public by design, not a secret. When unset, the "Send GIF" row is hidden from the attach menu and nothing else breaks. |

After changing `.env`, restart Metro (`npm start`) so the new value gets inlined. No native rebuild is required for `EXPO_PUBLIC_*` changes.

### Building an APK

```bash
# Generate the native Android project
npx expo prebuild --platform android

# Build the APK
cd android && ./gradlew assembleRelease

# Install on connected device
adb install app/build/outputs/apk/release/app-release.apk
```

### EAS Build (cloud)

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

## Project Structure

```
src/
  components/       # Reusable UI components (SendSheet, ContactProfileSheet, etc.)
  contexts/         # React contexts (WalletContext, NostrContext)
  navigation/       # React Navigation setup
  screens/          # App screens (Home, Earn, Learn, Friends, Account)
  services/         # Business logic (NWC, LNURL, Nostr, contacts)
  styles/           # Theme and shared styles
  types/            # TypeScript type definitions
assets/             # Images and icons
modules/            # Custom native Expo modules (Amber signer)
plugins/            # Expo config plugins
```

## Figma Designs

https://www.figma.com/proto/ROutnkBQtGGGzqi8yz0Maf/Lightning-Piggy?node-id=1-26&m=dev&scaling=scale-down&page-id=0%3A1&starting-point-node-id=19%3A519&show-proto-sidebar=1&t=P3MkR2W1YVSwtmIQ-1

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[WTFPL](http://www.wtfpl.net/)
