import type { VerifiedEvent } from 'nostr-tools';
import { rot13 } from '../utils/rot13';
import { encodeGeohash } from '../utils/geohash';
import type { HiddenPiggy } from './piggyStorageService';
import { LP_CLIENT_TAG } from './nip89ClientTag';

/**
 * NIP-GC publish + subscribe layer. Wraps the existing SimplePool from
 * `nostrService` with pure builders for the three event kinds we care
 * about — kind 37516 cache listings, kind 7516 found-logs, kind 1111
 * NIP-22 comments — plus a predicate that detects Lightning Piggy
 * caches via their NIP-32 label marker.
 *
 * **Critical security rule:** the LNURL bearer token NEVER goes on a
 * published event. See project memory `feedback_lnurl_never_on_relays.md`.
 * The label `["l","payout-lnurl-w","com.lightningpiggy.app"]` is the only signal LP
 * uses on the wire; the LNURL itself stays on the physical artifact +
 * local SecureStore. Tests assert this invariant.
 */

export const GC_LISTING_KIND = 37516;
export const GC_FOUND_LOG_KIND = 7516;
export const GC_COMMENT_KIND = 1111;
export const GC_VERIFICATION_KIND = 7517;

// NIP-52 calendar event kinds — used by the Events sub-screen (M7) to
// surface nearby Bitcoin meetups. We only consume kind 31923
// (time-based) for v1; kind 31922 (date-based all-day) and kind 31925
// (RSVPs) are out of scope.
export const NIP52_TIME_BASED_KIND = 31923;

export const LP_LABEL_NAMESPACE = 'com.lightningpiggy.app';
export const LP_LABEL_VALUE = 'payout-lnurl-w';

// -----------------------------------------------------------------------------
// builders — return unsigned events ready for `signEvent` from NostrContext
// -----------------------------------------------------------------------------

/**
 * Build the unsigned kind 37516 listing event for a HiddenPiggy. Smart
 * defaults applied: D=1, T=1, S=micro, t=traditional, name=lnurlDescription[:60].
 * Multi-precision g tags from precision 3 to 9.
 *
 * Throws if the piggy has no lat/lon (we refuse to publish a cache
 * without a location — there's nothing for finders to discover).
 */
export const buildCacheListing = (
  piggy: HiddenPiggy,
): { kind: number; created_at: number; tags: string[][]; content: string } => {
  if (typeof piggy.lat !== 'number' || typeof piggy.lon !== 'number') {
    throw new Error('Cannot publish cache listing — piggy has no lat/lon. Drop a pin first.');
  }
  const g9 = piggy.geohash ?? encodeGeohash(piggy.lat, piggy.lon, 9);
  const tags: string[][] = [
    [...LP_CLIENT_TAG],
    ['d', piggy.id],
    ['name', piggy.name ?? piggy.lnurlDescription?.slice(0, 60) ?? 'Hunt Piggy'],
  ];
  // g tags at every precision from 3 to 9 — cheap on event size,
  // dramatically widens the prefix-filter surface.
  for (let n = 3; n <= 9; n += 1) tags.push(['g', g9.slice(0, n)]);
  tags.push(['D', String(piggy.difficulty ?? 1)]);
  tags.push(['T', String(piggy.terrain ?? 1)]);
  tags.push(['S', piggy.size ?? 'micro']);
  tags.push(['t', piggy.cacheType ?? 'traditional']);
  // rot13 here is the geocaching-traditional hint obfuscation — NOT
  // encryption. The hint is intentionally public on the relay; rot13
  // exists so a finder doesn't accidentally read it while scrolling
  // the cache page and has to opt into a one-tap decode to view it.
  // Anyone with a relay sub can trivially reverse it. See parseCache
  // below for the symmetric decode on the read side.
  if (piggy.hint) tags.push(['hint', rot13(piggy.hint)]);
  if (piggy.hintPhotoUrl) tags.push(['image', piggy.hintPhotoUrl]);
  // NIP-32 label marker — flags this cache as a Lightning Piggy. Stamp it
  // when the listing IS a Piggy: either a withdraw link is present on this
  // device, OR it's a known LP listing being edited where the bearer lives
  // on another device (cross-device edit, #596 — `lnurlw` is blank there).
  // Two invariants ride on this: editing a plain NIP-GC cache (no link, not
  // LP) must NOT silently convert it into a Piglet (#681 review); and a
  // cross-device edit of a real Piglet must NOT downgrade it to a plain
  // cache by dropping the label. LP-ness follows the listing, NOT the amount,
  // so a Piglet whose amount we couldn't recover still stays a Piglet.
  const isLp = Boolean(piggy.lnurlw || piggy.isLpPiggy);
  if (isLp) {
    tags.push(['L', LP_LABEL_NAMESPACE]);
    tags.push(['l', LP_LABEL_VALUE, LP_LABEL_NAMESPACE]);
  }
  // wait / uses / amount are LP-only display hints — gate their emission on
  // LP-ness (the same signal as the label) so a plain NIP-GC cache never
  // carries a "Prize" / cooldown chip with no `L`/`l` label backing it.
  // This is the authoritative guard: even if the edit UI populated the
  // fields on a non-LP listing, the on-wire event stays consistent (#681).
  if (isLp) {
    // Display-only; the live LNURL on the finder side stays authoritative.
    if (typeof piggy.waitSecondsHint === 'number')
      tags.push(['wait', String(piggy.waitSecondsHint)]);
    if (typeof piggy.usesHint === 'number') tags.push(['uses', String(piggy.usesHint)]);
    // Compute sats first and only write `amount` when it's ≥ 1 sat: a sub-
    // 1000 msat maxWithdrawable floors to 0 sats, which would still advertise
    // the misleading "0 sats" / hide the ⚡ badge this guard exists to prevent.
    const prizeSats =
      typeof piggy.maxWithdrawableMsat === 'number'
        ? Math.floor(piggy.maxWithdrawableMsat / 1000)
        : 0;
    if (prizeSats > 0) tags.push(['amount', String(prizeSats)]);
  }
  // NIP-40 expiration: the wizard's "Expires after" picker (#23)
  // writes the chosen unix-seconds onto the HiddenPiggy record at
  // save time. We mirror that onto the published event so finders see
  // the same date and NIP-40-honouring relays drop the listing on
  // schedule. When the user picked "Never" piggy.expiresAt is null
  // and we omit the tag entirely so the cache stays up indefinitely.
  // For pre-#23 records that don't carry the field, default to 1
  // year from now (the previous hardcoded behaviour) so cold-publishes
  // of an older Piggy still get an expiry.
  if (typeof piggy.expiresAt === 'number') {
    tags.push(['expiration', String(piggy.expiresAt)]);
  } else if (!('expiresAt' in piggy)) {
    tags.push(['expiration', String(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60)]);
  }
  return {
    kind: GC_LISTING_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: piggy.description ?? piggy.lnurlDescription ?? '',
  };
};

/**
 * Build a kind 7516 found-log. `cacheCoord` is the addressable
 * `<kind>:<pubkey>:<d-tag>` triple of the cache being logged. Optional
 * imageUrl + sats become tags rendered by LP / NIP-GC clients.
 */
export const buildFoundLog = (
  cacheCoord: string,
  content: string,
  opts: { imageUrl?: string; sats?: number } = {},
): { kind: number; created_at: number; tags: string[][]; content: string } => {
  const tags: string[][] = [[...LP_CLIENT_TAG], ['a', cacheCoord]];
  if (opts.imageUrl) tags.push(['image', opts.imageUrl]);
  if (typeof opts.sats === 'number' && opts.sats > 0) {
    tags.push(['amount', String(opts.sats)]);
  }
  return { kind: GC_FOUND_LOG_KIND, created_at: Math.floor(Date.now() / 1000), tags, content };
};

/**
 * Build a kind 1111 NIP-22 comment for a cache. Used for non-find
 * status updates — DNF (did-not-find), maintenance, archived, or
 * general note. Top-level only (no nested-reply support yet).
 */
export const buildComment = (
  cacheCoord: string,
  cacheOwnerPubkey: string,
  content: string,
  type: 'dnf' | 'maintenance' | 'archived' | 'note' = 'note',
): { kind: number; created_at: number; tags: string[][]; content: string } => {
  const tags: string[][] = [
    [...LP_CLIENT_TAG],
    // Root pointers (uppercase per NIP-22).
    ['A', cacheCoord],
    ['K', String(GC_LISTING_KIND)],
    ['P', cacheOwnerPubkey],
    // Parent pointers — same as root for top-level comments.
    ['a', cacheCoord],
    ['k', String(GC_LISTING_KIND)],
    ['p', cacheOwnerPubkey],
    ['t', type],
  ];
  return { kind: GC_COMMENT_KIND, created_at: Math.floor(Date.now() / 1000), tags, content };
};

// -----------------------------------------------------------------------------
// parsers / predicates
// -----------------------------------------------------------------------------

export interface ParsedCache {
  /** Addressable coordinate `<kind>:<pubkey>:<d>` for use in `["a", …]` refs. */
  coord: string;
  hiderPubkey: string;
  d: string;
  name: string;
  description: string;
  geohash: string | null;
  difficulty: number | null;
  terrain: number | null;
  size: string | null;
  cacheType: string | null;
  /** ROT13-decoded plaintext hint, ready to render. */
  hint: string | null;
  imageUrl: string | null;
  isLpPiggy: boolean;
  /** LP payout-display hints parsed off the listing — null when absent. */
  waitSeconds: number | null;
  uses: number | null;
  payoutSats: number | null;
  createdAt: number;
  expiresAt: number | null;
}

export const parseCache = (event: VerifiedEvent): ParsedCache | null => {
  if (event.kind !== GC_LISTING_KIND) return null;
  const tag = (k: string): string | undefined => event.tags.find((t) => t[0] === k)?.[1];
  const d = tag('d');
  if (!d) return null;
  const gtags = event.tags.filter((t) => t[0] === 'g').map((t) => t[1]);
  const longestGeohash = gtags.sort((a, b) => b.length - a.length)[0] ?? null;
  const D = parseInt(tag('D') ?? '', 10);
  const T = parseInt(tag('T') ?? '', 10);
  const exp = parseInt(tag('expiration') ?? '', 10);
  const wait = parseInt(tag('wait') ?? '', 10);
  const uses = parseInt(tag('uses') ?? '', 10);
  const amount = parseInt(tag('amount') ?? '', 10);
  return {
    coord: `${GC_LISTING_KIND}:${event.pubkey}:${d}`,
    hiderPubkey: event.pubkey,
    d,
    name: tag('name') ?? 'Unnamed cache',
    description: event.content,
    geohash: longestGeohash,
    difficulty: Number.isFinite(D) ? D : null,
    terrain: Number.isFinite(T) ? T : null,
    size: tag('S') ?? null,
    cacheType: tag('t') ?? null,
    // rot13 here is the symmetric decode for the geocaching-traditional
    // hint obfuscation written on the build side — NOT decryption. The
    // hint is intentionally public on the relay; rot13 just reverses
    // the publish-side rot13 so callers see the plaintext.
    hint: tag('hint') ? rot13(tag('hint') as string) : null,
    imageUrl: tag('image') ?? null,
    isLpPiggy: hasLpLabel(event.tags),
    waitSeconds: Number.isFinite(wait) ? wait : null,
    uses: Number.isFinite(uses) ? uses : null,
    payoutSats: Number.isFinite(amount) ? amount : null,
    createdAt: event.created_at,
    expiresAt: Number.isFinite(exp) ? exp : null,
  };
};

/**
 * Predicate — does this kind 37516 listing carry the Lightning Piggy
 * `com.lightningpiggy.app / payout-lnurl-w` label? Drives the 🐷 vs 📍 pin distinction
 * on the Map and Discover surfaces.
 */
export const hasLpLabel = (tags: string[][]): boolean =>
  tags.some((t) => t[0] === 'l' && t[1] === LP_LABEL_VALUE && t[2] === LP_LABEL_NAMESPACE);

/**
 * Returns the longest `g` tag on an event, or null. Helpers like the
 * map subscriber use this to recompute distance cheaply.
 */
export const longestGeohash = (tags: string[][]): string | null => {
  const candidates = tags.filter((t) => t[0] === 'g').map((t) => t[1]);
  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
};

/**
 * Flat parsed shape of a kind 7516 found-log. `coord` is the addressable
 * `<kind>:<pubkey>:<d>` of the cache being logged; `finderPubkey` is the
 * event author. Mirrors `parseCache` so both the community leaderboards
 * and the recently-found feed can consume a pure, testable value instead
 * of poking at raw tags. `amountSats` is the self-reported claim amount
 * (the `amount` tag is in millisats), null when absent.
 */
export interface ParsedFoundLog {
  id: string;
  coord: string;
  finderPubkey: string;
  createdAt: number;
  amountSats: number | null;
}

export const parseFoundLog = (event: VerifiedEvent): ParsedFoundLog | null => {
  if (event.kind !== GC_FOUND_LOG_KIND) return null;
  const coord = event.tags.find((t) => t[0] === 'a')?.[1] ?? '';
  if (!coord) return null;
  const amount = event.tags.find((t) => t[0] === 'amount')?.[1];
  const amountSats = amount ? Math.round(Number(amount) / 1000) || null : null;
  return {
    id: event.id,
    coord,
    finderPubkey: event.pubkey,
    createdAt: event.created_at,
    amountSats,
  };
};

/**
 * Resolve a coord string back into its (hiderPubkey, d) parts. Coord
 * format is `<kind>:<pubkey>:<d>` per NIP-01.
 */
export const parseCacheCoord = (
  coord: string,
): { kind: number; pubkey: string; d: string } | null => {
  const parts = coord.split(':');
  if (parts.length !== 3) return null;
  const kind = parseInt(parts[0], 10);
  if (!Number.isFinite(kind)) return null;
  return { kind, pubkey: parts[1], d: parts[2] };
};

// -----------------------------------------------------------------------------
// NIP-52 events (kind 31923) — used by the Events sub-screen
// -----------------------------------------------------------------------------

export interface ParsedEvent {
  coord: string;
  organiserPubkey: string;
  d: string;
  title: string;
  description: string;
  /** Unix-seconds start timestamp parsed from the `start` tag. */
  startsAt: number | null;
  /** Optional unix-seconds end timestamp. */
  endsAt: number | null;
  /** Free-form location string from the `location` tag. May be a venue
   * name, address, or "video call link" — NIP-52 leaves it open. */
  location: string | null;
  geohash: string | null;
  imageUrl: string | null;
  hashtags: string[];
}

export const parseNip52Event = (event: VerifiedEvent): ParsedEvent | null => {
  if (event.kind !== NIP52_TIME_BASED_KIND) return null;
  const tag = (k: string): string | undefined => event.tags.find((t) => t[0] === k)?.[1];
  const d = tag('d');
  if (!d) return null;
  const start = parseInt(tag('start') ?? '', 10);
  const end = parseInt(tag('end') ?? '', 10);
  const gtags = event.tags.filter((t) => t[0] === 'g').map((t) => t[1]);
  const longestGh = gtags.sort((a, b) => b.length - a.length)[0] ?? null;
  const hashtags = event.tags.filter((t) => t[0] === 't').map((t) => t[1]);
  return {
    coord: `${NIP52_TIME_BASED_KIND}:${event.pubkey}:${d}`,
    organiserPubkey: event.pubkey,
    d,
    title: tag('title') ?? tag('name') ?? 'Untitled event',
    description: event.content,
    startsAt: Number.isFinite(start) ? start : null,
    endsAt: Number.isFinite(end) ? end : null,
    location: tag('location') ?? null,
    geohash: longestGh,
    imageUrl: tag('image') ?? null,
    hashtags,
  };
};
