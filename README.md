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
- Send payments by scanning QR codes or pasting invoices
- Send to lightning addresses (user@domain) via LNURL-pay
- NIP-57 zaps to Nostr contacts
- Receive payments with QR code generation
- Real-time balance display with fiat conversion
- Transaction history
- Nostr identity login (nsec or Amber signer on Android)
- Friends tab with Nostr contacts and phone contacts
- Follow/unfollow Nostr contacts (kind 3 event publishing)
- Add friends by pasting npub or scanning QR code
- Contact profile cards with deep linking to Nostr apps
- QR code sharing for npub and Lightning address
- Secure credential storage (expo-secure-store)

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
