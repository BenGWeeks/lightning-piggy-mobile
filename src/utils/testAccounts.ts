// The project's own Lightning Piggy TEST / demo Nostr accounts — the
// "Piggies" (Big / Middle / Little / Evil). Their nsecs live in `.env`
// (MAESTRO_NSEC_* / MAESTRO_NPUB_*) and Maestro E2E flows publish caches
// (Piglets) and NIP-52 events as these identities. That test traffic is
// exactly what we want to SEE in dev / preview builds, but it must NOT
// leak into the public PRODUCTION app's Explore / near-you / map /
// discover surfaces — real users shouldn't see "Big Piggy"'s demo
// meetups and Piglets.
//
// This is distinct from `devEventDenylist.ts`:
//   - devEventDenylist = orphaned, disposable signers we lost the key for.
//     Filtered ALWAYS (every build) because the events are pure litter.
//   - testAccounts (this file) = ACTIVE fixtures we still control and want
//     in dev/preview. Filtered ONLY in production (see appEnvironment.ts).
//
// Format: lowercase hex pubkeys (what `event.pubkey` / `parsed.*Pubkey`
// carry at the ingestion point) — same convention as devEventDenylist so
// callers do no per-event decode work. The npubs are kept in comments so a
// maintainer can eyeball them against `.env` (MAESTRO_NPUB_*).
//
// To add / remove a test account: edit THIS list only — it's the single
// source of truth that every prod-hide call routes through.

const HIDDEN_IN_PROD_PUBKEYS: ReadonlySet<string> = new Set([
  // BIG Piggy — npub1enkml7dx7fsm8zq83dczyh06g9r7l2447p32wu32p5jn7qmqclns65f4st
  'ccedbff9a6f261b388078b70225dfa4147efaab5f062a7722a0d253f0360c7e7',
  // MIDDLE Piggy — npub1fvhukn3uxrqnv0z27h36dt0tl6fu64ev84tuxx42g3uajzrpyqmq8vtatq
  '4b2fcb4e3c30c1363c4af5e3a6adebfe93cd572c3d57c31aaa4479d908612036',
  // LITTLE Piggy — npub1mxen9q96wvexrk94t877p4nzkm9s0phrq7znzwsgdnw2j43eg4lqtqp265
  'd9b33280ba733261d8b559fde0d662b6cb0786e30785313a086cdca95639457e',
  // EVIL Piggy — npub1pd68tzvuxkw786h7mfr3a0tm3h49ung879c9wrvtltkwpxrk6n7qa38l77
  '0b7475899c359de3eafeda471ebd7b8dea5e4d07f170570d8bfaece09876d4fc',
]);

/**
 * Is this pubkey one of the Lightning Piggy test accounts that should be
 * hidden in production builds? O(1) Set membership — safe to call per
 * event on the relay-ingestion hot path.
 *
 * Case-insensitive: the input is lower-cased before lookup (the Set is
 * already canonical lowercase hex), matching how pubkeys are treated
 * elsewhere in the codebase. A mixed/upper-case pubkey — which an upstream
 * decode or relay could hand us — therefore can't slip past the prod-hide.
 *
 * Pure / build-agnostic: this only answers "is it a test account?" — the
 * PRODUCTION gate lives in the caller (combine with `isProductionBuild()`
 * via `hideTestContentInProd`). That separation keeps this list trivially
 * unit-testable without mocking the native build environment.
 */
export const isHiddenInProdPubkey = (pubkey: string): boolean =>
  HIDDEN_IN_PROD_PUBKEYS.has(pubkey.toLowerCase());

// Test-only access to the underlying Set so tests can assert membership /
// count without exposing a mutable surface to production callers. Mirrors
// the `__TEST__` convention in devEventDenylist.ts.
export const __TEST__ = { HIDDEN_IN_PROD_PUBKEYS };
