# Release note signing with Amber

Ben's signing key stays in Amber. The GitHub Actions client uses a different,
non-account key to authenticate its NIP-46 requests. Only the runner connects to
Amber and publishes notes; local previews and tests are offline.

## One-time setup (Ben runs these commands)

1. In Amber, select **BenGWeeks** (public key
   `971615b70ad9ec896f8d5ba0f2d01652f1dfe5f9ced81ac9469ca7facefad68b`).
   Open Amber's Nostr Connect / NIP-46 connection screen, create a connection for
   “Lightning Piggy releases”, select a relay reachable by both the phone and
   GitHub Actions, and copy its `bunker://…` URI with the connection secret.
   Labels vary by Amber version. Do not export Ben's private key.
2. In Bash, disable shell tracing and send a newly generated **client** key
   straight to the repository secret. Run this **once**, then retain this secret
   across releases so Amber sees the same client public key:

   ```bash
   set +x
   set -o pipefail
   nak key generate | gh secret set NOSTR_RELEASE_CLIENT_KEY --repo BenGWeeks/lightning-piggy-mobile
   ```

3. Paste the bunker URI into a hidden prompt, then send it straight to GitHub.
   The URI is never placed in command history or printed:

   ```bash
   read -r -s -p 'Amber bunker URI: ' release_bunker_uri
   printf '\n'
   printf '%s' "$release_bunker_uri" | gh secret set NOSTR_RELEASE_BUNKER_URI --repo BenGWeeks/lightning-piggy-mobile
   unset release_bunker_uri
   ```

4. Keep Amber available on the phone. On the first workflow run, approve the
   connection for the release client. Confirm the account and displayed note,
   then approve the kind-1 signing request. Amber may remember per-kind approval;
   leave it asking each time if you want to review every announcement. No local
   pairing or test publication is needed.

## Preview and run

Preview only (no network, keys or Amber needed):

```bash
node scripts/build-release-note.mjs --tag v1.4.1
node scripts/build-release-note.mjs --tag v1.4.2 --event
npm run test:release-note
```

After this feature is on the default branch, published stable releases trigger
**Actions → Release Nostr note** automatically. To test or re-run a specific tag,
choose **Run workflow**, select the default branch, and enter the release tag, or:

```bash
gh workflow run release-nostr-note.yml --repo BenGWeeks/lightning-piggy-mobile --ref main -f tag=v1.4.2
```

A manual dispatch publishes a real note, including for prereleases. The tag must
have an existing GitHub Release so the link can be appended to its body. The
runner reads notes at that tag, before the notes archive/reset. Empty notes use
the existing TestFlight git-log fallback from the same tag checkout.

Approval times out after ten minutes with a clear failure. Wrong account,
modified content/tags, invalid signatures and fewer than two accepting relays
also fail. If secrets are absent, the workflow emits a notice and skips. This is
an independent workflow and does not block app builds. Publication starts when
the Release is published; APK attachment and TestFlight availability follow the
separate build workflow.

The runner discovers the latest kind-10002 list via purplepag.es,
relay.primal.net and user.kindpag.es, then uses write or unmarked relays. With no
write relays it falls back to relay.primal.net, relay.damus.io and nos.lol. Local
machines must not publish or contact Amber, nor connect to relay.damus.io,
nos.lol or nostr.mom. See each relay's OK/fail in the Actions log and the njump
link appended to the Release body.

A re-run can publish another note because each event has a fresh timestamp.
Check the Release body before retrying a partially successful run (a note may
already exist if publishing succeeded but editing the Release failed).
