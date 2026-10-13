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

- Add contact info, search and media menu (#1441)
- Relay details page with operator info and allowed kinds (#1455)
- Shared settings components (#1466)
- Simpler Notifications page with the server setting (#1468)
- Wallets, profile and about pages on the shared rows (#1477)
- KnowAll AI Sallie and Poppie card designs (#1478)
- Zaplie card design (#1479)
- Wise Owl card design (#1483)

### Improved

- Pace verification and retain trust after restart (#1444)

### Fixed

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

