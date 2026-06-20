import type { HiddenPiggy } from '../services/piggyStorageService';
import { GC_LISTING_KIND, type ParsedCache } from '../services/nostrPlacesService';

/**
 * Project a local `HiddenPiggy` SecureStore record into the `ParsedCache`
 * shape the My Piglets list renders. Lets the Hidden section surface
 * locally-saved DRAFTS (`isPublic === false`) that were never published
 * to relays — without these adapters a draft writes a `HiddenPiggy` but
 * no `ParsedCache`, so the page (which reads only the relay-derived
 * mirror) never shows it and the user thinks it's lost (#909).
 *
 * `HiddenPiggy.id` equals the kind-37516 `d` tag minted at create time
 * (see `buildCacheListing` in `nostrPlacesService.ts`), so the coord is
 * `37516:<pubkey>:<id>` — the same key the published cache would carry.
 * That makes the dedupe in `mergeHiddenWithDrafts` line up a draft with
 * its eventual published twin.
 *
 * `HiddenPiggy.createdAt` is stored in **milliseconds**; `ParsedCache`
 * uses **unix seconds**, so we divide. `expiresAt` is already seconds on
 * both sides.
 */
export const hiddenPiggyToParsedCache = (piggy: HiddenPiggy, pubkey: string): ParsedCache => ({
  coord: `${GC_LISTING_KIND}:${pubkey}:${piggy.id}`,
  hiderPubkey: pubkey,
  d: piggy.id,
  name: piggy.name ?? piggy.lnurlDescription ?? 'Untitled Piglet',
  description: piggy.description ?? '',
  geohash: piggy.geohash ?? null,
  difficulty: piggy.difficulty ?? null,
  terrain: piggy.terrain ?? null,
  size: piggy.size ?? null,
  cacheType: piggy.cacheType ?? null,
  hint: piggy.hint ?? null,
  imageUrl: piggy.hintPhotoUrl ?? null,
  isLpPiggy: Boolean(piggy.lnurlw || piggy.isLpPiggy),
  waitSeconds: piggy.waitSecondsHint ?? null,
  uses: piggy.usesHint ?? null,
  payoutSats:
    typeof piggy.maxWithdrawableMsat === 'number'
      ? Math.floor(piggy.maxWithdrawableMsat / 1000) || null
      : null,
  createdAt: Math.floor(piggy.createdAt / 1000),
  expiresAt: piggy.expiresAt ?? null,
});

/** A Hidden-section row: a cache plus whether it's a local-only draft. */
export interface HiddenRow {
  cache: ParsedCache;
  /** True when this row is sourced from a local `HiddenPiggy` that has no
   * matching published `ParsedCache` on relays — i.e. a draft. Drives the
   * "Draft" badge and the local-edit navigation path. */
  isDraft: boolean;
}

/**
 * Build the Hidden section's rows as the union of relay/cache-sourced
 * caches authored by the user and local draft `HiddenPiggy` records.
 *
 * Deduped by coord: a published `ParsedCache` always wins over its local
 * draft twin (so once a draft is published the badge flips to the normal
 * expiry view and there's no duplicate row). Drafts are the local records
 * whose coord has no published entry. Sorted newest-first by `createdAt`.
 */
export const mergeHiddenWithDrafts = (
  publishedCaches: ParsedCache[],
  localPiggies: HiddenPiggy[],
  pubkey: string,
): HiddenRow[] => {
  const lower = pubkey.toLowerCase();
  const rows = new Map<string, HiddenRow>();
  // Published / relay-sourced caches authored by me — these win on dedupe.
  for (const cache of publishedCaches) {
    if (cache.hiderPubkey.toLowerCase() !== lower) continue;
    rows.set(cache.coord, { cache, isDraft: false });
  }
  // Local records that have no published twin become draft rows.
  for (const piggy of localPiggies) {
    const draft = hiddenPiggyToParsedCache(piggy, pubkey);
    if (rows.has(draft.coord)) continue;
    rows.set(draft.coord, { cache: draft, isDraft: true });
  }
  return [...rows.values()].sort((a, b) => b.cache.createdAt - a.cache.createdAt);
};
