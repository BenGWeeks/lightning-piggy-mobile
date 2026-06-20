// Pure shaping helpers for Market vendors. Kept out of the data module and
// the screens so they're independently unit-testable (coverage scope:
// src/utils). No React, no I/O.
import * as nip19 from 'nostr-tools/nip19';
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

/**
 * Extract the vendor's Nostr pubkey (hex) from its `nostrUrl`, or `null`
 * when the vendor has no Nostr identity / the URL isn't a recognisable
 * npub link. `nostrUrl` is an njump.me web link
 * (`https://njump.me/npub1…`), so we pull the last path segment and decode
 * it. Returns hex so callers can navigate straight to the in-app contact
 * profile (where Message / Zap live) instead of opening the web link.
 *
 * Pure + total: never throws — a malformed or non-npub value yields `null`
 * so the caller can fall back to opening the shop URL.
 */
export function vendorNostrPubkey(vendor: MarketVendor): string | null {
  const raw = vendor.nostrUrl.trim();
  if (!raw) return null;
  // Last non-empty path segment (drops a trailing slash); also tolerates a
  // bare `npub1…` value with no URL wrapper.
  const segment = raw.split('/').filter(Boolean).pop();
  if (!segment || !segment.startsWith('npub1')) return null;
  try {
    const decoded = nip19.decode(segment);
    return decoded.type === 'npub' ? decoded.data : null;
  } catch {
    return null;
  }
}

/** Whether the vendor exposes a usable Nostr identity we can open in-app. */
export function vendorHasNostr(vendor: MarketVendor): boolean {
  return vendorNostrPubkey(vendor) !== null;
}
