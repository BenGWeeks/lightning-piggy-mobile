# Security Policy

Lightning Piggy handles money and private keys, so we take security reports seriously and appreciate
responsible disclosure.

## Supported versions

Security fixes are made against:

| Version                                                                        | Supported |
| ------------------------------------------------------------------------------ | --------- |
| `main` branch                                                                  | Yes       |
| Latest [release](https://github.com/BenGWeeks/lightning-piggy-mobile/releases) | Yes       |
| Older releases                                                                 | No        |

Please update to the latest release before reporting, and check whether the issue still reproduces.

## Reporting a vulnerability

**Please do not open a public issue, pull request or discussion for a security problem.**

Report it privately using GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/BenGWeeks/lightning-piggy-mobile/security) of this repository.
2. Choose **Report a vulnerability**
   ([direct link](https://github.com/BenGWeeks/lightning-piggy-mobile/security/advisories/new)).
3. Describe the issue, the affected version or commit, the steps to reproduce, and the impact you expect.

**Never include secrets in a report.** Do not paste Nostr private keys (`nsec`), NWC connection strings
(`nostr+walletconnect://...`), seed phrases or mnemonics, LNURL-withdraw links, or invoices containing
private information. If you need to demonstrate an issue, use a throwaway test identity and a wallet that
holds no real funds. If you have accidentally exposed a real secret, rotate it first (generate a new key,
revoke the NWC connection) and then tell us.

## What is in scope

- The Lightning Piggy mobile app in this repository (Android and iOS).
- Handling of wallet credentials and NWC connections, on-chain keys, and local encrypted storage.
- Nostr signer integrations: local key (`nsec`), Amber (NIP-55) and Nostr Connect (NIP-46).
- Direct and group messaging, including NIP-17 and Marmot (MLS) end-to-end encrypted chats.
- Push-notification registration and the data the app sends to the notification service.
- Hunt / Piglet LNURL-withdraw handling (for example, leaking a bearer token to a public relay).

## What is out of scope

- The companion service [`BenGWeeks/lightning-piggy-watcher`](https://github.com/BenGWeeks/lightning-piggy-watcher)
  has its own policy; please report issues there.
- Vulnerabilities in third-party wallets, relays, LNbits instances, Nostr clients (for example Amber or
  White Noise) or the Boltz service. Report those to their maintainers.
- Issues that require a rooted or jailbroken device, physical access to an unlocked device, or malware
  already running on the device.
- Social engineering, spam, or denial of service through volume.
- Findings from automated scanners without a demonstrated, realistic impact.

## What to expect

- We aim to **acknowledge your report within a few days**.
- We will investigate, keep you updated, and tell you whether we consider it a vulnerability.
- We follow **coordinated disclosure**: please give us reasonable time to ship a fix before you disclose
  publicly. We will agree a disclosure timeline with you, and credit you in the advisory and release notes
  if you wish.
- This is a volunteer-run project and we cannot offer a bug bounty.

For how the app stores and protects credentials, see [`docs/SECURITY.adoc`](docs/SECURITY.adoc).
