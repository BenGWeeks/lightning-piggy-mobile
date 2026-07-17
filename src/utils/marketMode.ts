// Marketplace "mode" — which set of sellers the Market section sources its
// products from. Mirrors the curation model on lightningpiggy.com/market/
// (Lightning Piggy preferred sellers) while letting the user widen the lens
// to their own Nostr web-of-trust.
//
// Pure data + selection helpers only (no React, no relay I/O) so the modes
// and the product filter are independently unit-testable (coverage scope:
// src/utils).
import type { MarketProduct } from '../data/marketProducts';
import { sellerOf } from '../data/marketProducts';

/**
 * The four marketplace modes.
 *   `preferred` — Lightning Piggy preferred sellers (the curated, designated
 *                 shops). DEFAULT, ACTIVE.
 *   `wotFriends` — products from sellers in the user's Nostr follow set
 *                  (web-of-trust "friends"). ACTIVE.
 *   `wotFof`    — friends-of-friends. Present but DISABLED (coming soon).
 *   `wotAll`    — the whole web of trust. Present but DISABLED (coming soon).
 */
export type MarketMode = 'preferred' | 'wotFriends' | 'wotFof' | 'wotAll';

/** Default mode for a fresh session — the curated preferred-sellers view. */
export const DEFAULT_MARKET_MODE: MarketMode = 'preferred';

/** UI descriptor for one marketplace mode. */
export interface MarketModeOption {
  mode: MarketMode;
  /** Selector label, e.g. "Lightning Piggy Preferred Sellers". */
  label: string;
  /** Whether the mode can be selected yet. Disabled modes render greyed
   * with a "coming soon" affordance and are non-selectable. */
  enabled: boolean;
}

/**
 * The mode options in display order. "Preferred Sellers" and "WoT: Friends"
 * are wired to actually filter the product source; the two friends-of-
 * friends / all tiers are present but disabled placeholders for now.
 */
export const MARKET_MODE_OPTIONS: readonly MarketModeOption[] = [
  { mode: 'preferred', label: 'Lightning Piggy Preferred Sellers', enabled: true },
  { mode: 'wotFriends', label: 'WoT: Friends', enabled: true },
  { mode: 'wotFof', label: 'WoT: Friends of Friends', enabled: false },
  { mode: 'wotAll', label: 'WoT: All', enabled: false },
];

/** Look up a mode option by mode. */
export function marketModeOption(mode: MarketMode): MarketModeOption {
  return MARKET_MODE_OPTIONS.find((o) => o.mode === mode) ?? MARKET_MODE_OPTIONS[0];
}

/** Whether a given mode is currently selectable. */
export function isMarketModeEnabled(mode: MarketMode): boolean {
  return marketModeOption(mode).enabled;
}

/**
 * Select the products visible under a given mode.
 *
 *   `preferred`  — the full curated catalogue (every product is, by
 *                  definition, from a Lightning Piggy preferred seller).
 *   `wotFriends` — only products whose seller has a Nostr identity the user
 *                  follows. `friendPubkeys` is the lowercase-hex follow set
 *                  (from `useTrustGraph().trustSet` / the kind-3 follows);
 *                  a product matches when its seller's pubkey is in the set.
 *   `wotFof` / `wotAll` — DISABLED tiers; treated as no-ops here (the UI
 *                  blocks selecting them). Like `preferred`, they return the
 *                  input `products` unchanged — the function applies no WoT
 *                  filtering of its own, so what comes back is exactly what
 *                  the caller passed (today, the curated catalogue).
 *
 * `sellerPubkeyOf` resolves a product's seller pubkey (hex) — injected so
 * this stays free of the nostr-tools decode dependency and trivially
 * testable. Returns a new array; never mutates the input.
 */
export function productsForMode(
  mode: MarketMode,
  products: MarketProduct[],
  friendPubkeys: ReadonlySet<string>,
  sellerPubkeyOf: (product: MarketProduct) => string | null,
): MarketProduct[] {
  if (mode !== 'wotFriends') return [...products];
  return products.filter((p) => {
    const pk = sellerPubkeyOf(p);
    return pk !== null && friendPubkeys.has(pk.toLowerCase());
  });
}

/** Whether a product is sold by a seller in the directory at all (sanity
 * filter shared by callers; an orphan seller is a data error). */
export function hasKnownSeller(product: MarketProduct): boolean {
  return sellerOf(product) !== undefined;
}
