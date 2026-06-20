// Pure shaping helpers for Market vendors. Kept out of the data module and
// the screens so they're independently unit-testable (coverage scope:
// src/utils). No React, no I/O.
import type { MarketShopType, MarketVendor } from '../data/marketVendors';

/**
 * URL-safe slug for a vendor name, used to build stable testIDs
 * (`market-vendor-card-<slug>`) so Maestro flows can target a specific
 * card regardless of position. Lower-cases, strips diacritics, and
 * collapses any run of non-alphanumerics to a single hyphen.
 */
export function vendorSlug(name: string): string {
  return (
    name
      .normalize('NFKD')
      // Drop combining marks left behind by NFKD (é -> e). U+0300–U+036F
      // is the Unicode "Combining Diacritical Marks" block.
      .replace(/[\u0300-\u036F]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

/**
 * Featured-first ordering. Featured vendors move to the front; within each
 * group the original (curated) order is preserved — `Array.prototype.sort`
 * is stable in modern engines (Hermes included), so equal-key items keep
 * their relative order. Returns a new array; never mutates the input.
 */
export function featuredFirst(vendors: MarketVendor[]): MarketVendor[] {
  return [...vendors].sort((a, b) => Number(b.featured) - Number(a.featured));
}

const SHOP_TYPE_LABEL: Record<MarketShopType, string> = {
  online: 'Online',
  physical: 'Physical',
  both: 'Online & Physical',
};

/** Human-readable label for a vendor's `shopType`. */
export function shopTypeLabel(shopType: MarketShopType): string {
  return SHOP_TYPE_LABEL[shopType] ?? SHOP_TYPE_LABEL.online;
}

/**
 * One-line location/shipping summary, mirroring the website card:
 * "Denmark · Ships to Worldwide" (the "Ships to" clause is dropped when
 * there are no shipping regions, e.g. physical-only stores).
 */
export function vendorLocationLine(vendor: MarketVendor): string {
  if (vendor.shippingRegions.length === 0) return vendor.country;
  return `${vendor.country} · Ships to ${vendor.shippingRegions.join(', ')}`;
}
