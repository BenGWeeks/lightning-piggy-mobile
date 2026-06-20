// Lightning Piggy "Market" vendor directory.
//
// Source of truth: the companion website repo (`lightning-piggy-website`),
// `src/data/vendors.json`, which its `/market` page renders via
// `src/components/ui/VendorCard.astro`. This module is a hand-ported,
// typed copy so the mobile Explore tab can show the same vendors. Keep the
// two in sync when either side changes.
//
// Asset / link resolution: some `logo` / `url` values in the website JSON
// are site-relative (e.g. `/images/logos/danish-bacon.png`,
// `/market/danish-bacon`). Those don't resolve inside the app, so they're
// prefixed here with the canonical site origin. Absolute `https://…`
// values are copied verbatim.
//
// --- Future live-feed seam (design only — NOT implemented here) ---------
// Today this is a static list. A future enhancement could SUPPLEMENT or
// REPLACE it with a live Nostr marketplace feed, pulling the SAME event
// kinds the website's `src/components/market/NostrProducts.astro` already
// queries:
//   • NIP-15 Marketplace — stalls (kind 30017) + products (kind 30018)
//   • NIP-99 Classified listings — kind 30402
// A loader implementing `MarketVendorSource` (below) would fetch those
// kinds from the user's relays, map each merchant/product into a
// `MarketVendor`, and merge with this hardcoded list (hardcoded first as a
// curated fallback). The maintainer wants hardcoded-only for now, so the
// fetch is deliberately left unimplemented — only the seam is defined.

/** Where a vendor sells. Mirrors the website's `shopType` enum, plus the
 * `both` value already present in the source JSON. */
export type MarketShopType = 'online' | 'physical' | 'both';

/** A single Market vendor. Field-for-field parity with the website's
 * `Vendor` interface in `VendorCard.astro`. */
export interface MarketVendor {
  /** Display name. */
  name: string;
  /** Home country of the vendor. */
  country: string;
  /** Regions the vendor ships to (empty for physical-only stores). */
  shippingRegions: string[];
  /** Whether the vendor is online, physical, or both. */
  shopType: MarketShopType;
  /** Short marketing blurb. */
  description: string;
  /** Primary link opened on tap. Absolute https URL (site-relative
   * values from the source JSON are pre-resolved to the site origin). */
  url: string;
  /** Logo image URL. Absolute https URL (site-relative pre-resolved). */
  logo: string;
  /** Optional njump.me / Nostr profile link. Empty string when unset. */
  nostrUrl: string;
  /** Optional X (Twitter) profile link. Empty string when unset. */
  xUrl: string;
  /** Featured vendors surface first and get a highlight treatment. */
  featured: boolean;
}

/**
 * Pluggable source of Market vendors. The hardcoded list satisfies this
 * synchronously today; a future live Nostr loader (NIP-15 30018 +
 * NIP-99 30402 — see file header) would implement the async variant and
 * merge with the hardcoded curated set.
 */
export interface MarketVendorSource {
  getVendors(): MarketVendor[] | Promise<MarketVendor[]>;
}

/** Canonical website origin used to resolve site-relative asset/link paths. */
export const LIGHTNING_PIGGY_SITE_ORIGIN = 'https://lightningpiggy.com';

export const MARKET_VENDORS: MarketVendor[] = [
  {
    name: 'Danish Bacon',
    country: 'Denmark',
    shippingRegions: ['Worldwide'],
    shopType: 'online',
    description:
      'Get your Lightning Piggy directly from the project team. Bitcoin over Lightning accepted! ⚡',
    url: `${LIGHTNING_PIGGY_SITE_ORIGIN}/market/danish-bacon`,
    logo: `${LIGHTNING_PIGGY_SITE_ORIGIN}/images/logos/danish-bacon.png`,
    nostrUrl: '',
    xUrl: '',
    featured: true,
  },
  {
    name: 'Robotechy',
    country: 'United Kingdom',
    shippingRegions: ['Worldwide'],
    shopType: 'online',
    description:
      '3D printing Bitcoin store with cases for Bitcoin Seed Signers and other accessories.',
    url: 'https://robotechy.com',
    logo: 'https://m.primal.net/JdnO.jpg',
    nostrUrl: 'https://njump.me/npub1yy0nyk6nj6tg4sx8nd7q5qcdw6pqd5e2cc0e8u2rmcgjhpvm63hsk67xe5',
    xUrl: 'https://x.com/IsaacWeeks',
    featured: false,
  },
  {
    name: 'The Bitcoin Hardware Store',
    country: 'El Salvador',
    shippingRegions: [],
    shopType: 'physical',
    description: 'Physical stores located in Bitcoin Beach, El Zonte and Bitcoin Berlín, Usulután.',
    url: 'https://tbhs.sv/',
    logo: 'https://unavatar.io/twitter/tbhs_sv',
    nostrUrl: '',
    xUrl: 'https://x.com/tbhs_sv',
    featured: false,
  },
  {
    name: 'SatoshiStore.io',
    country: 'Austria',
    shippingRegions: ['Worldwide'],
    shopType: 'online',
    description: 'Wonderful merch, piggies incoming.',
    url: 'https://satoshistore.io/collections/lightning-piggy',
    logo: 'https://unavatar.io/twitter/satoshistoreio',
    nostrUrl: 'https://njump.me/npub1eclyv67suswsx5q0guyds43uzaj0ymkgvkr5chmuwsxsj9229zms8tankk',
    xUrl: 'https://x.com/satoshistoreio',
    featured: false,
  },
  {
    name: 'BitcoinStuffStore',
    country: 'Netherlands',
    shippingRegions: ['Europe'],
    shopType: 'both',
    description: 'Bitcoin merchandise, miners, and gadgets\nfor the true Bitcoiner',
    url: 'https://www.bitcoinstuffstore.com/product/lightning-piggy/',
    logo: `${LIGHTNING_PIGGY_SITE_ORIGIN}/images/logos/bitcoinstuffstore.png`,
    nostrUrl: 'https://njump.me/npub135q6dvnjah9023xszmjs2wvd4gqhn2trku52wt2lv8cl4hc8ltjsk0w4sq',
    xUrl: 'https://twitter.com/ZijlstraMario',
    featured: false,
  },
];
