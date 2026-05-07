# NIP-46 pairing screenshots

These slots are reserved for the visual verification of PR #283 (NIP-46 signer support):

- `01-login-sheet-with-nip46-button.png` — the Connect Nostr sheet showing the new "Use NIP-46 Signer (Clave / nsec.app)" button below the existing nsec input + Amber button.
- `02-pairing-qr-screen.png` — the NIP-46 pairing screen with the `nostrconnect://` QR rendered + the "Waiting for bunker…" spinner.
- `03-paired-logged-in.png` — back to the home tab post-pair, with the user logged in via NIP-46 (verifiable in Account → Nostr by `signerType === 'nip46'`).

Capture instructions (when a build with this code is available):

```bash
adb exec-out screencap -p > /tmp/screen.png
convert /tmp/screen.png -resize 1200x1200\> docs/screenshots/nip46-pairing/01-login-sheet-with-nip46-button.png
```

Drive the app via Maestro (`tests/e2e/test-login-nip46.yaml`) to reach the pairing screen for shot 02, or use a Clave / nsec.app session to complete the pair for shot 03.
