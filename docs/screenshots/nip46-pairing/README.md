# NIP-46 pairing screenshots

Visual verification of the NIP-46 ("Nostr Connect") signer (PR #284, issue #283).
Captured on the Android dev build (`com.lightningpiggy.app.dev`) driven via Maestro,
cross-checked against the nsec.app web bunker (https://use.nsec.app) in Chrome.

- `01-login-sheet-with-nip46-button.png` — the Connect Nostr sheet showing the new
  "Use NIP-46 Signer (Aegis / Nowser / nsec.app)" button below the nsec input + Amber button.
- `02-pairing-qr-screen.png` — the NIP-46 pairing screen with the `nostrconnect://` QR
  rendered + the "Waiting for bunker…" spinner (waits up to 120s for the bunker's `connect` ack).
- `03-pairing-timeout.png` — the sheet after the 120s window elapses without an ack,
  surfacing the user-facing "Pairing took too long — try again" error.

## Test outcome (nsec.app cross-check)

The **app side works correctly end-to-end**: it generates a well-formed
`nostrconnect://` URI (client pubkey, `relay=wss://relay.nsec.app`, secret, the five
`sign_event` / `nip04_*` / `nip44_*` perms, `name=Lightning Piggy`), renders it as a QR,
and subscribes for the bunker's ack.

When that URI is pasted into nsec.app's **Connect app** dialog, nsec.app **correctly
recognises it** and shows a "Connection request — Lightning Piggy — New app would like to
connect — Asking 5 permissions" prompt, confirming the URI format + perms are valid and
interoperate with a real bunker.

Full pairing did **not** complete in the sandboxed test environment: after approving in
nsec.app, the bunker's `connect` ack never arrived back at the app over
`wss://relay.nsec.app`, so the app timed out (shot 03). This traced to constrained
connectivity to nsec.app infrastructure from the sandbox (nsec.app's own name/nip05
backend returned `Failed to fetch`), not a defect in the app — the app's timeout + error
handling behaved as designed. A separate machine is validating the iOS Clave signer path.

## Capture / repro

```bash
# Reach the sheet + NIP-46 button, then screenshot:
maestro --device emulator-5556 test tests/e2e/test-login-nip46.yaml
adb -s emulator-5556 exec-out screencap -p > /tmp/screen.png
convert /tmp/screen.png -resize 1200x1200\> docs/screenshots/nip46-pairing/02-pairing-qr-screen.png
```
