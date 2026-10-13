import { sanitizeDisplayText } from './sanitizeDisplayText';
import { nip19 } from 'nostr-tools';
import { sellerOf, type MarketProduct } from '../data/marketProducts';
import { MARKET_VENDORS } from '../data/marketVendors';
import { vendorNostrPubkey } from './marketVendors';

export interface MerchantProfile {
  displayName?: string | null;
  name?: string | null;
  nip05?: string | null;
}
export interface MarketMerchant {
  id: string;
  label: string;
  count: number;
  curated: boolean;
}
const curated = new Map(
  MARKET_VENDORS.flatMap((vendor) => {
    const pubkey = vendorNostrPubkey(vendor);
    return pubkey ? [[pubkey, vendor] as const] : [];
  }),
);
const text = (value: unknown) => sanitizeDisplayText(value, { maxLen: 64 });

/** Gamma's shop is the merchant's kind-0 profile, never a 30405 collection.
 * A curated shop name takes precedence over that profile's display fields. */
export function merchantLabel(
  pubkey: string,
  profile?: MerchantProfile,
  shopName?: string,
): string {
  const name = text(shopName) || text(profile?.displayName) || text(profile?.name);
  if (name) return name;
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 12)}…${npub.slice(-4)}`;
}
export function merchantId(product: MarketProduct): string | null {
  return product.listing?.event.pubkey ?? sellerOf(product)?.name ?? null;
}
export function curatedMerchant(pubkey: string) {
  return curated.get(pubkey);
}

/** Input is the active scope's reduced snapshot: deletions are already removed.
 * Expirations are checked again because a cached snapshot can age while open. */
export function marketMerchants(
  products: readonly MarketProduct[],
  now = Date.now() / 1000,
): MarketMerchant[] {
  const options = new Map<string, MarketMerchant>();
  for (const product of products) {
    const expiry = product.listing?.event.tags.find((tag) => tag[0] === 'expiration')?.[1];
    if (expiry && (!Number.isFinite(Number(expiry)) || Number(expiry) <= now)) continue;
    const id = merchantId(product);
    if (!id) continue;
    const previous = options.get(id);
    if (previous) {
      previous.count++;
      continue;
    }
    options.set(id, {
      id,
      label: product.sellerName,
      count: 1,
      curated: product.listing ? curated.has(id) : MARKET_VENDORS.some((v) => v.name === id),
    });
  }
  return [...options.values()].sort(
    (a, b) =>
      Number(b.curated) - Number(a.curated) ||
      b.count - a.count ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id),
  );
}

/** Keep an off-page selection visible without exceeding the chip budget. */
export function collapsedMerchants(
  merchants: readonly MarketMerchant[],
  selected: string | null,
  limit = 8,
) {
  const visible = merchants.slice(0, limit);
  const chosen = merchants.find((merchant) => merchant.id === selected);
  if (chosen && !visible.includes(chosen) && visible.length) visible[visible.length - 1] = chosen;
  return { visible, remaining: merchants.length - visible.length };
}

/** Upgrade the name-based remembered filters from #1367 to stable merchant keys.
 * Keep unresolved values until the completed-snapshot validator can decide. */
export function resolveMerchantSelection(
  selected: string | null,
  merchants: readonly MarketMerchant[],
  aliases?: ReadonlyMap<string, string>,
): string | null {
  if (selected === null || merchants.some((m) => m.id === selected)) return selected;
  const alias = aliases?.get(selected);
  if (alias && merchants.some((m) => m.id === alias)) return alias;
  return (
    merchants.find(
      (m) =>
        m.label === selected || (/^[a-f0-9]{64}$/.test(m.id) && merchantLabel(m.id) === selected),
    )?.id ?? selected
  );
}
