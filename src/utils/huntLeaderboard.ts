import type { ParsedCache, ParsedFoundLog } from '../services/nostrPlacesService';

/**
 * Pure ranking + sorting helpers behind the Geo-caches community sections
 * (recently added / recently found rails + hider / finder leaderboards).
 *
 * All functions here are side-effect-free and deterministic so they're
 * cheap to unit-test — the relay subscriptions live in
 * `useHuntCommunity`, the presentation in the `Hunt*Section` components.
 *
 * Leaderboard semantics mirror the website `/leaderboard` page
 * (LightningPiggy/website#16): hiders rank by *distinct caches authored*
 * (kind-37516), finders by *distinct caches found* (kind-7516 found-logs,
 * deduped per cache). A `pigletCount` sub-tally counts the Lightning-Piggy
 * subset so the UI can show the piglet (`PiggyBank`) sub-badge.
 */

export interface LeaderboardEntry {
  pubkey: string;
  /** Distinct caches authored (hiders) or found (finders). */
  total: number;
  /** Subset of `total` that are Lightning Piggies (carry the LP label). */
  pigletCount: number;
}

/** Only the fields the hider ranking needs — keeps test fixtures tiny. */
export type HiderCacheInput = Pick<
  ParsedCache,
  'coord' | 'hiderPubkey' | 'isLpPiggy' | 'createdAt'
>;

/** Only the fields the finder ranking / feed needs. */
export type FinderFindInput = Pick<ParsedFoundLog, 'coord' | 'finderPubkey' | 'createdAt'>;

/**
 * Collapse a list of cache revisions to the latest event per `coord`.
 * Replaceable-event semantics: a hider can re-publish the same `d`, and
 * relays may serve several revisions — the newest `createdAt` wins.
 */
const latestByCoord = <T extends { coord: string; createdAt: number }>(
  items: T[],
): Map<string, T> => {
  const seen = new Map<string, T>();
  for (const item of items) {
    const existing = seen.get(item.coord);
    if (!existing || item.createdAt > existing.createdAt) seen.set(item.coord, item);
  }
  return seen;
};

/**
 * Rank hiders by distinct caches authored. Deduped by `coord` first so
 * multiple revisions of one cache count once. `pigletCount` tallies the
 * LP-labelled subset. Sorted by total desc, then pigletCount desc, then
 * pubkey asc for a stable, deterministic order.
 */
export const rankHiders = (caches: HiderCacheInput[], limit = 10): LeaderboardEntry[] => {
  const perAuthor = new Map<string, { total: number; pigletCount: number }>();
  for (const cache of latestByCoord(caches).values()) {
    const entry = perAuthor.get(cache.hiderPubkey) ?? { total: 0, pigletCount: 0 };
    entry.total += 1;
    if (cache.isLpPiggy) entry.pigletCount += 1;
    perAuthor.set(cache.hiderPubkey, entry);
  }
  return sortEntries(perAuthor).slice(0, limit);
};

/**
 * Rank finders by distinct caches found. A finder logging the same cache
 * twice counts once (dedupe by `finder+coord`). `pigletCoords` is the set
 * of cache coords known to be Lightning Piggies (best-effort — a find
 * whose cache we haven't seen simply doesn't count toward pigletCount).
 */
export const rankFinders = (
  finds: FinderFindInput[],
  pigletCoords: ReadonlySet<string>,
  limit = 10,
): LeaderboardEntry[] => {
  // Distinct (finder, coord) pairs — one credit per cache per finder.
  const seenPairs = new Set<string>();
  const perFinder = new Map<string, { total: number; pigletCount: number }>();
  for (const find of finds) {
    if (!find.coord) continue;
    const pairKey = `${find.finderPubkey}|${find.coord}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    const entry = perFinder.get(find.finderPubkey) ?? { total: 0, pigletCount: 0 };
    entry.total += 1;
    if (pigletCoords.has(find.coord)) entry.pigletCount += 1;
    perFinder.set(find.finderPubkey, entry);
  }
  return sortEntries(perFinder).slice(0, limit);
};

const sortEntries = (
  perPubkey: Map<string, { total: number; pigletCount: number }>,
): LeaderboardEntry[] =>
  [...perPubkey.entries()]
    .map(([pubkey, { total, pigletCount }]) => ({ pubkey, total, pigletCount }))
    .sort(
      (a, b) =>
        b.total - a.total || b.pigletCount - a.pigletCount || a.pubkey.localeCompare(b.pubkey),
    );

/**
 * Newest-published caches for the "Recently added" rail. Deduped to the
 * latest revision per coord, expired listings dropped (NIP-40 — relays
 * that ignore expiration keep serving them), sorted by `createdAt` desc.
 */
export const sortRecentCaches = (
  caches: ParsedCache[],
  opts: { limit?: number; nowSec?: number } = {},
): ParsedCache[] => {
  const { limit = 12, nowSec = Date.now() / 1000 } = opts;
  return [...latestByCoord(caches).values()]
    .filter((c) => c.expiresAt === null || c.expiresAt > nowSec)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
};

/**
 * Newest found-logs for the "Recently found" feed. Deduped by event id,
 * optionally narrowed to a set of authors (the friends filter — pass the
 * lowercased trust set), sorted by `createdAt` desc.
 */
export const sortRecentFinds = (
  finds: ParsedFoundLog[],
  opts: { limit?: number; authors?: ReadonlySet<string> } = {},
): ParsedFoundLog[] => {
  const { limit = 12, authors } = opts;
  const byId = new Map<string, ParsedFoundLog>();
  for (const f of finds) if (!byId.has(f.id)) byId.set(f.id, f);
  let list = [...byId.values()];
  if (authors) list = list.filter((f) => authors.has(f.finderPubkey.toLowerCase()));
  return list.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
};
