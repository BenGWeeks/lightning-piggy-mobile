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

- **See shop orders right in your chats.** When a merchant sends you a Lightning order or receipt over an encrypted message, it now appears as a clear order card — item count, total in sats, and status — instead of raw text.
- **Pay an order in a tap.** Order cards now have a Pay button and a QR code, so you can pay the Lightning invoice for your order straight from the conversation, or scan it with another wallet.
