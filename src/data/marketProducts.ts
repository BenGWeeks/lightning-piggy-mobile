// Lightning Piggy "Market" PRODUCT catalogue.
//
// The Explore Market section lists PRODUCTS (not shops), mirroring the
// companion website at https://lightningpiggy.com/market/, which presents a
// grid of individual product cards (image, title, price, seller) sourced
// from a curated set of designated Lightning Piggy "preferred seller" shops.
//
// Source of truth for the SELLERS is `src/data/marketVendors.ts` (the same
// hand-ported vendor directory the website renders). This module layers the
// individual PRODUCTS on top, each tagged with the `sellerName` of the
// vendor it comes from, so a product card can show "from <shop>".
//
// --- Why hardcoded, and the live-feed seam (design only) ----------------
// On the website each listing is "pulled live from the vendor's Nostr
// profile". A future enhancement could SUPPLEMENT or REPLACE this static
// list with a live Nostr product feed, pulling the SAME event kinds the
// website's `src/components/market/NostrProducts.astro` already queries:
//   • NIP-15 Marketplace — stalls (kind 30017) + products (kind 30018)
//   • NIP-99 Classified listings — kind 30402
// A loader implementing `MarketProductSource` (below) would fetch those
// kinds from the relevant author set (preferred sellers, or the user's
// web-of-trust follows — see `marketMode.ts`), map each event into a
// `MarketProduct`, and merge with this curated list. The data-source plug
// point is `MarketProductSource.getProducts()`; only the seam is defined —
// the relay fetch is deliberately left unimplemented for now.

import { MARKET_VENDORS, type MarketVendor } from './marketVendors';

/** A single product offered by a Market seller. Field layout mirrors the
 * website's product cards (image, title, price, seller). */
export interface MarketProduct {
  /** Stable id — used as the React key and to build testIDs. */
  id: string;
  /** Product title, e.g. "Lightning Piggy". */
  title: string;
  /** Short marketing blurb (one or two lines on the card). */
  description: string;
  /** Price in satoshis (the app's native unit). Authored from the
   * website's fiat reference price at a documented snapshot rate — see
   * the PRICE_SNAPSHOT note below. */
  priceSats: number;
  /** Original fiat reference price the sats figure was derived from, kept
   * for provenance / a future live re-quote (e.g. "£60"). */
  priceFiatLabel: string;
  /** Product image URL (absolute https). */
  image: string;
  /** Display name of the seller/shop this product comes from. Must match a
   * `MarketVendor.name` in {@link MARKET_VENDORS} so the card can resolve
   * the seller (logo, Nostr identity, shop URL). */
  sellerName: string;
  /** Link opened on "Buy" — the product (or seller) page. Absolute https. */
  url: string;
  /** Featured products surface first in the rail/list. */
  featured: boolean;
}

/**
 * Pluggable source of Market products. The hardcoded list satisfies this
 * synchronously today; a future live Nostr loader (NIP-15 products 30018 +
 * NIP-99 classifieds 30402 — see file header) would implement the async
 * variant, scoped to a given author set (preferred sellers' pubkeys, or the
 * user's web-of-trust follows), and merge with the curated set.
 */
export interface MarketProductSource {
  getProducts(): MarketProduct[] | Promise<MarketProduct[]>;
}

// PRICE_SNAPSHOT — the sats figures below were derived from the website's
// GBP reference prices at ~£0.0006/sat (≈ £60k/BTC), the rate at authoring
// time (2026-06). A live feed would quote sats directly (or re-derive from
// the seller's fiat price + a spot rate) instead of baking them in.
const PRICE_SNAPSHOT_SATS_PER_GBP = Math.round(1 / 0.0006);

// Convert an authored GBP reference price into the baked sats figure,
// keeping the data table readable (one place defines the rate).
const gbpToSats = (gbp: number): number => Math.round(gbp * PRICE_SNAPSHOT_SATS_PER_GBP);

export const MARKET_PRODUCTS: MarketProduct[] = [
  {
    id: 'robotechy-lightning-piggy',
    title: 'Lightning Piggy',
    description:
      'Electronic cash piggy bank for children that accepts Bitcoin sent over Lightning.',
    priceSats: gbpToSats(60),
    priceFiatLabel: '£60',
    image:
      'https://cdn.nostrcheck.me/d4a4687a0edb77f57bf30a53e4a886237058a52778c573deb0c63c94da1937fe.webp',
    sellerName: 'Robotechy',
    url: 'https://robotechy.com',
    featured: true,
  },
  {
    id: 'robotechy-bag-charm',
    title: 'Lightning Piggy Bag Charm',
    description: 'Keyring / bag charm with an NFC tag you can program with pay links.',
    priceSats: gbpToSats(4.5),
    priceFiatLabel: '£4.50',
    image:
      'https://cdn.nostrcheck.me/8a02bf562b2df6b0138ad2d72d2b9a25c244950012f0e45de966666c3a1a68bc.webp',
    sellerName: 'Robotechy',
    url: 'https://robotechy.com',
    featured: false,
  },
  {
    id: 'robotechy-nostr-badge',
    title: 'Nostr Badge',
    description: 'Keyring with a pin backing — wear your Nostr pride.',
    priceSats: gbpToSats(4.5),
    priceFiatLabel: '£4.50',
    image:
      'https://cdn.nostrcheck.me/0c43c6b00d25917f733a18863857fcb941f8d10f7224e8997e8d6907db00946b.webp',
    sellerName: 'Robotechy',
    url: 'https://robotechy.com',
    featured: false,
  },
  {
    id: 'satoshistore-lightning-piggy-merch',
    title: 'Lightning Piggy Merch',
    description: 'Wonderful Lightning Piggy merch — piggies incoming.',
    priceSats: gbpToSats(25),
    priceFiatLabel: '£25',
    image: 'https://lightningpiggy.com/images/logos/danish-bacon.png',
    sellerName: 'SatoshiStore.io',
    url: 'https://satoshistore.io/collections/lightning-piggy',
    featured: false,
  },
  {
    id: 'bitcoinstuffstore-lightning-piggy',
    title: 'Lightning Piggy',
    description: 'Lightning Piggy from a European Bitcoin merch store, miners and gadgets.',
    priceSats: gbpToSats(65),
    priceFiatLabel: '£65',
    image: 'https://www.bitcoinstuffstore.com/wp-content/uploads/2024/07/Lightningpiggy.webp',
    sellerName: 'BitcoinStuffStore',
    url: 'https://www.bitcoinstuffstore.com/product/lightning-piggy/',
    featured: false,
  },
  {
    id: 'danish-bacon-lightning-piggy',
    title: 'Lightning Piggy',
    description: 'Get your Lightning Piggy directly from the project team. ⚡',
    priceSats: gbpToSats(55),
    priceFiatLabel: '£55',
    image: 'https://lightningpiggy.com/images/logos/danish-bacon.png',
    sellerName: 'Danish Bacon',
    url: 'https://lightningpiggy.com/market/danish-bacon',
    featured: true,
  },
];

/** Resolve the {@link MarketVendor} a product is sold by, or `undefined`
 * when the catalogue references a seller not in the directory (which the
 * `marketMode.test.ts` "every product references a known seller" invariant
 * forbids, so this is total in practice).
 */
export function sellerOf(product: MarketProduct): MarketVendor | undefined {
  return MARKET_VENDORS.find((v) => v.name === product.sellerName);
}
