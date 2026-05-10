import type { VerifiedEvent } from 'nostr-tools';
import { rot13 } from '../utils/rot13';
import { encodeGeohash } from '../utils/geohash';
import type { HiddenPiggy } from './piggyStorageService';

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

export const LP_LABEL_NAMESPACE = 'com.lightningpiggy.app';
export const LP_LABEL_VALUE = 'payout-lnurl-w';

// -----------------------------------------------------------------------------
// builders — return unsigned events ready for `signEvent` from NostrContext
// -----------------------------------------------------------------------------

/**
 * Build the unsigned kind 37516 listing event for a HiddenPiggy. Smart
 * defaults applied: D=1, T=1, S=micro, t=traditional, name=memo[:60].
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
    ['d', piggy.id],
    ['name', piggy.name ?? (piggy.memo.slice(0, 60) || 'Hunt Piggy')],
  ];
  // g tags at every precision from 3 to 9 — cheap on event size,
  // dramatically widens the prefix-filter surface.
  for (let n = 3; n <= 9; n += 1) tags.push(['g', g9.slice(0, n)]);
  tags.push(['D', String(piggy.difficulty ?? 1)]);
  tags.push(['T', String(piggy.terrain ?? 1)]);
  tags.push(['S', piggy.size ?? 'micro']);
  tags.push(['t', piggy.cacheType ?? 'traditional']);
  if (piggy.hint) tags.push(['hint', rot13(piggy.hint)]);
  if (piggy.hintPhotoUrl) tags.push(['image', piggy.hintPhotoUrl]);
  // NIP-32 label marker — flags this cache as a Lightning Piggy
  // (claim happens on the physical NFC tag / QR, not on this event).
  tags.push(['L', LP_LABEL_NAMESPACE]);
  tags.push(['l', LP_LABEL_VALUE, LP_LABEL_NAMESPACE]);
  // 30-day expiration so abandoned Piggies age out naturally.
  tags.push(['expiration', String(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60)]);
  return {
    kind: GC_LISTING_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: piggy.memo,
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
  const tags: string[][] = [['a', cacheCoord]];
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
    hint: tag('hint') ? rot13(tag('hint') as string) : null,
    imageUrl: tag('image') ?? null,
    isLpPiggy: hasLpLabel(event.tags),
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
