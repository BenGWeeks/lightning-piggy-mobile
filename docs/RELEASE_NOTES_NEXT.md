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

### Fixed

- **Zap (⚡) buttons work again.** On the Friends list the zap button now appears for any contact who has a Lightning address and sends sats when tapped. On a contact's profile the zap button is **always shown** — and if you can't zap yet (no wallet connected, or that person hasn't published a Lightning address) tapping it now tells you **why** instead of doing nothing.
