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

- **Receive on-chain, land as Lightning.** Send Bitcoin to your on-chain address and the app swaps it to Lightning for you automatically (via a Boltz submarine swap) — no manual steps.
- **A celebration when on-chain money lands.** Incoming on-chain payments now show a full-screen celebration overlay, the same as Lightning payments.
- **Watch your transfer happen.** Sending a payment now replaces the form with a step-by-step progress display so you can see each stage.
- **React to and zap individual messages.** Long-press any message in a chat to add a reaction or send it a zap.
- **Full Spanish app.** Switch to Spanish (Account → Appearance → Language) and the whole app is translated, not just the tab labels.
- **Pick where a received payment lands.** When creating an invoice you can now choose any of your wallets as the destination.

### Improved

- Monogram tab backgrounds on Messages, Friends and Explore for a more branded look.
- Smoother pink→purple brand fade behind the wallet card on Home.

### Fixed

- Logging out now wipes group-chat message text and the places cache from the device; removing a wallet clears its cached data.
- Pasting or typing into the Send address / memo fields no longer drops or duplicates characters.
