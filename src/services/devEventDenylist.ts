// Pubkeys that published Lightning Piggy / NIP-GC test events with
// disposable nsecs during development — we have no key material left
// to publish a NIP-09 delete or replace the event under the same
// `d` tag, so the events sit on relays indefinitely. The app filters
// them client-side at the event-ingestion layer so they never reach
// storage, the rail, the map, or the Hunt screen.
//
// Criteria for adding an entry:
//   1. The pubkey published a NIP-GC kind 37516 or NIP-52 kind 31923
//      event during dev/testing.
//   2. The key has been confirmed lost (not present in any current
//      .env / fixture — see scripts/_piggyFixtures.mjs for the active
//      named fixtures).
//   3. The event can't be replaced because the `d` tag was used by a
//      legitimate fixture (different signer, same coord), OR the
//      publish was a one-off with a unique `d` we no longer track.
//
// What NOT to add:
//   - BIG / MIDDLE / LITTLE / EVIL Piggy fixtures (active, key still
//     in .env, can re-publish to overwrite). Filtering these would
//     hide legitimate test traffic we want to see during dev.
//   - Any pubkey we still have the nsec for — publish a delete /
//     replacement instead.
//
// Removing entries is fine: relays eventually drop old events under
// retention policies, and this deny-list shrinks naturally. It's not
// a security boundary — a hostile relay could re-spread these events
// regardless. It's a UX hygiene layer.
//
// Format: hex pubkeys (not npubs) — that's what `event.pubkey` carries
// at the ingestion point, so no decode work per event.

// Module-private — the Set itself isn't exported because `ReadonlySet`
// is a structural type guard only; consumers can still cast to `any`
// and mutate. `isDevLeftover` below is the single public API surface.
// Same pattern as `linkPreviewBlocklist.ts` etc.
const DEV_LEFTOVER_PUBKEYS: ReadonlySet<string> = new Set([
  // Four disposable signers of `d=big-piggy-geo-cache-1` (name="Geo-Cache 1"),
  // discovered 2026-05-18 while testing #31 perf fixes on the emulator.
  // BIG Piggy's own ccedbff9… signer is *not* on this list — it's an
  // active fixture and we want to see its test events.
  //
  //   npub1hrfcue22mlezgsvqq2h82g244p9gdk4kl22tf0y7s89fufwua8nsf78dfl
  'b8d38e654adff224418002ae752155a84a86dab6fa94b4bc9e81ca9e25dce9e7',
  //   npub1zfgeyrkjlpksluhpfk269kay9e0scg76demx2j0v9qccl54xqpxqxpef49
  '1251920ed2f86d0ff2e14d95a2dba42e5f0c23da6e766549ec28318fd2a6004c',
  //   npub1tfh4veuuf4kkkznvp054evd76a6cc5akrppqu0w627df3cnhcdeq02man6
  '5a6f56679c4d6d6b0a6c0be95cb1bed7758c53b618420e3dda579a98e277c372',
  //   npub1h994qya2zd7panwllt4qwwe8ngx85lg6x5xnpf4aakrayp50t6tsurqqlq
  'b94b5013aa137c1ecddffaea073b279a0c7a7d1a350d30a6bded87d2068f5e97',
  // One-off disposable signer of `d=swavesey-trad-cache` (name="Swavesey
  // Stash"), published 2026-05-10 via scripts/publish-test-piggy.mjs with
  // LP_LABEL=0 — deliberately unlabelled so it masqueraded as a vanilla
  // third-party NIP-GC cache during testing. Predates the script's
  // named-fixture guard (#774 investigation), so the key is a lost
  // throwaway: no nsec to NIP-09 delete or replace the event.
  //   npub1kh88hkvztclxzak38h8mxnknddcqy9dl5mmseag7sq3zta2cz3hqun06j6
  'b5ce7bd9825e3e6176d13dcfb34ed36b700215bfa6f70cf51e802225f558146e',
]);

// O(1) membership test against the leftover set. Called per-event at
// the subscribe + querySync entry points in nostrPlacesPublisher — a
// hot path, so we keep the check trivial and avoid string normalisation
// (relays return lowercase hex; the constants above are lowercase hex;
// nostr-tools yields lowercase hex).
export const isDevLeftover = (pubkey: string): boolean => DEV_LEFTOVER_PUBKEYS.has(pubkey);

// Test-only access to the underlying Set. Tests import this rather
// than the Set directly so production callers get a single, hard-to-
// misuse API surface (`isDevLeftover`). Mirrors the convention used by
// `linkPreviewBlocklist.ts`, `linkPreviewStorage.ts`, `zapSenderProfileStorage.ts`.
export const __TEST__ = { DEV_LEFTOVER_PUBKEYS };
