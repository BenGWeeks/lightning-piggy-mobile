/**
 * Web-of-trust filtering for NIP-GC caches (kind 37516) and NIP-52
 * calendar events (kind 31923).
 *
 * **Why this matters.** A kind 37516 event is a geo-cache listing —
 * a stranger publishing one is, by design, telling a stranger to
 * walk to a coordinate. The benign failure mode is a phishing LNURL
 * on the cache. The worst case is a physical lure: a "treasure" at
 * an address someone wants to entice a victim (in the limit, a
 * child) to. We default the filter ON and make turning it off a
 * deliberate, warned action.
 *
 * **How it works.** Anything published by a pubkey in the *trust
 * set* is shown. The trust set is the union of:
 *   - the user's own pubkey (their own caches/events always pass)
 *   - the user's kind-3 follow list (`followPubkeys` from `NostrContext`)
 *   - `DEFAULT_SEED_PUBKEYS` — platform-curated baseline so a brand-new
 *     user with no follows still sees Ben's + Lightning Piggy's content
 *     instead of an empty Explore.
 *
 * We *don't* publish a kind-3 on the user's behalf to bake seeds into
 * their relay-side contact list — that's a write to their identity with
 * relay-wide side effects without explicit consent. Seeds are a
 * client-side overlay; the user is free to actually follow these pubkeys
 * (or unmute / block them) via the normal profile flow.
 */

/**
 * Hex pubkeys (lowercase) treated as platform-trusted seeds. New users
 * see content from these accounts even before they have any follows of
 * their own. Decode via `nip19.decode(npub).data` if you need to add or
 * verify a seed — keep the hex form here so we never decode at runtime.
 */
export const DEFAULT_SEED_PUBKEYS: readonly string[] = [
  // Ben Weeks — the project owner. nostr:npub1jutptdc2m8kgjmudtws095qk2tcale0eemvp4j2xnjnl4nh6669slrf04x
  '971615b70ad9ec896f8d5ba0f2d01652f1dfe5f9ced81ac9469ca7facefad68b',
  // Lightning Piggy team account. nostr:npub1y2qcaseaspuwvjtyk4suswdhgselydc42ttlt0t2kzhnykne7s5swvaffq
  '22818ec33d8078e64964b561c839b74433f2371552d7f5bd6ab0af325a79f429',
  // bitcoinevents.uk — UK Bitcoin meetup index publishing NIP-52 events.
  // nostr:npub1g8ag22auywa5c5de6w9ujenpyhrrp9qq8sjzram02xldttmmwurqfd0hqk
  '41fa852bbc23bb4c51b9d38bc9666125c63094003c2421f76f51bed5af7b7706',
];

/**
 * Build the set of pubkeys whose caches/events pass the WoT filter.
 *
 * The trust set is the union of:
 *   - the user's own pubkey (own content always passes)
 *   - L1: their direct follows (kind-3 contact list)
 *   - L2: friends-of-follows (each L1's kind-3 contact list)
 *   - `DEFAULT_SEED_PUBKEYS` when `includeSeeds` is true
 *
 * @param userPubkey  Logged-in user's hex pubkey (null if logged out).
 * @param l1Follows   Direct follows from `NostrContext.followPubkeys`.
 * @param l2Follows   Friends-of-follows (see `fetchL2Follows`). Pass an
 *                    empty set while L2 is still loading — the filter
 *                    will be over-aggressive but safe until L2 lands.
 * @param includeSeeds  When true (default), include `DEFAULT_SEED_PUBKEYS`.
 *                      Set false only if the user has explicitly muted
 *                      the platform-curated baseline.
 */
export const computeTrustSet = (
  userPubkey: string | null,
  l1Follows: ReadonlySet<string>,
  l2Follows: ReadonlySet<string> = new Set(),
  includeSeeds: boolean = true,
): Set<string> => {
  const out = new Set<string>();
  if (userPubkey) out.add(userPubkey.toLowerCase());
  l1Follows.forEach((pk) => out.add(pk.toLowerCase()));
  l2Follows.forEach((pk) => out.add(pk.toLowerCase()));
  if (includeSeeds) for (const seed of DEFAULT_SEED_PUBKEYS) out.add(seed);
  return out;
};

/**
 * True iff `pubkey` is in the trust set. Centralised so the predicate
 * stays trivial to test and consumers don't accidentally compare case-
 * sensitively (Nostr pubkeys are case-insensitive lowercase hex).
 */
export const isPubkeyTrusted = (pubkey: string, trustSet: ReadonlySet<string>): boolean =>
  trustSet.has(pubkey.toLowerCase());
