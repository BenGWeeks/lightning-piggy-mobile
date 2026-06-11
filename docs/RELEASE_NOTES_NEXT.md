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

- **Pay by NFC from the Send sheet.** Send now has three modes — QR scan, paste, and NFC — switched with icon toggles. Pick the NFC waves, hold your phone against a Lightning payment tag (invoice, Lightning address or LNURL), and the payment details fill in just like scanning a QR.
