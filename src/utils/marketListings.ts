import { nip19, type Event } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import type { MarketVendor } from '../data/marketVendors';

export interface MarketListing {
  event: Event;
  currency: string;
  priceLabel: string;
  vendor: MarketVendor;
}

const tag = (event: Event, name: string) => event.tags.find((t) => t[0] === name)?.[1];

export function safeMarketUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Parse only supported, active listings; retain the signed event's actual identity. */
export function parseMarketListing(event: Event, now = Date.now() / 1000): MarketProduct | null {
  if (![30018, 30402].includes(event.kind) || event.content.length > 32768) return null;
  const d = tag(event, 'd');
  // NIP-19 TLV lengths are one byte, so naddr can't encode an identifier over
  // 255 UTF-8 bytes — reject it rather than build a broken "Open listing" link.
  if (!d || new TextEncoder().encode(d).length > 255 || event.tags.length > 256) return null;
  // A lone surrogate makes encodeURIComponent (used for the product id) throw,
  // which would abort the whole snapshot — drop just this listing.
  try {
    encodeURIComponent(d);
  } catch {
    return null;
  }
  const expiry = tag(event, 'expiration');
  if (expiry && (!Number.isFinite(Number(expiry)) || Number(expiry) <= now)) return null;
  let title: unknown;
  let description: unknown;
  let amount: unknown;
  let unit: unknown;
  let image: unknown;
  let frequency: unknown;
  if (event.kind === 30018) {
    try {
      const p = JSON.parse(event.content);
      if (
        !p ||
        p.id !== d ||
        (p.quantity !== null && (!Number.isInteger(p.quantity) || p.quantity <= 0))
      )
        return null;
      title = p.name;
      description = p.description;
      amount = p.price;
      unit = p.currency;
      image = Array.isArray(p.images) ? p.images[0] : undefined;
    } catch {
      return null;
    }
  } else {
    const status = tag(event, 'status');
    if (status && status !== 'active') return null;
    const price = event.tags.find((t) => t[0] === 'price');
    title = tag(event, 'title');
    description = event.content;
    amount = price?.[1];
    unit = price?.[2];
    frequency = price?.[3];
    image = tag(event, 'image');
  }
  if (typeof title !== 'string' || !title.trim() || title.length > 200) return null;
  if (typeof unit !== 'string' || !/^[a-zA-Z]{3,8}$/.test(unit)) return null;
  if ((typeof amount !== 'string' && typeof amount !== 'number') || String(amount).trim() === '')
    return null;
  const price = Number(amount);
  if (!Number.isFinite(price) || price < 0 || price > 1e12) return null;
  const currency = unit.toUpperCase();
  const isSats = ['SAT', 'SATS'].includes(currency);
  const sats = isSats ? price : currency === 'BTC' ? price * 1e8 : 0;
  if (
    (isSats || currency === 'BTC') &&
    (!Number.isSafeInteger(Math.round(sats)) || Math.abs(sats - Math.round(sats)) > 1e-6)
  )
    return null;
  const recurrence =
    typeof frequency === 'string' && /^[a-z]{1,16}$/.test(frequency) ? `/${frequency}` : '';
  const priceLabel = `${String(amount)} ${currency}${recurrence}`;
  const address = nip19.naddrEncode({ identifier: d, pubkey: event.pubkey, kind: event.kind });
  const url = safeMarketUrl(tag(event, 'r')) ?? `https://njump.me/${address}`;
  const sellerName = `${event.pubkey.slice(0, 8)}…${event.pubkey.slice(-4)}`;
  const vendor: MarketVendor = {
    name: sellerName,
    country: '',
    shippingRegions: [],
    shopType: 'online',
    description: '',
    url,
    logo: '',
    nostrUrl: `https://njump.me/${nip19.npubEncode(event.pubkey)}`,
    xUrl: '',
    featured: false,
  };
  return {
    id: `nostr-${event.kind}-${event.pubkey}-${encodeURIComponent(d)}`,
    title: title.trim(),
    description: typeof description === 'string' ? description.slice(0, 12000) : '',
    priceSats: Math.round(sats),
    priceFiatLabel: priceLabel,
    image: safeMarketUrl(image) ?? '',
    sellerName,
    url,
    featured: false,
    listing: { event, currency, priceLabel, vendor },
  };
}

/** Newest addressable revision wins, including sold/malformed revisions. */
export function reduceMarketListings(
  events: readonly Event[],
  authors: ReadonlySet<string>,
  now?: number,
): MarketProduct[] {
  const latest = new Map<string, Event>();
  const deletedIds = new Set<string>();
  const deletedAddresses = new Map<string, number>();
  for (const event of events) {
    if (!authors.has(event.pubkey)) continue;
    if (event.kind === 5) {
      for (const t of event.tags) {
        if (t[0] === 'e') deletedIds.add(`${event.pubkey}:${t[1]}`);
        if (t[0] === 'a' && t[1]?.split(':')[1] === event.pubkey) {
          deletedAddresses.set(t[1], Math.max(deletedAddresses.get(t[1]) ?? 0, event.created_at));
        }
      }
      continue;
    }
    if (![30018, 30402].includes(event.kind)) continue;
    const d = tag(event, 'd');
    if (!d) continue;
    const key = `${event.kind}:${event.pubkey}:${d}`;
    const previous = latest.get(key);
    if (
      !previous ||
      event.created_at > previous.created_at ||
      (event.created_at === previous.created_at && event.id < previous.id)
    )
      latest.set(key, event);
  }
  const products: MarketProduct[] = [];
  for (const [address, event] of latest) {
    if (
      deletedIds.has(`${event.pubkey}:${event.id}`) ||
      (deletedAddresses.get(address) ?? -1) >= event.created_at
    )
      continue;
    const product = parseMarketListing(event, now);
    if (product) products.push(product);
  }
  return products.sort(
    (a, b) => b.listing!.event.created_at - a.listing!.event.created_at || a.id.localeCompare(b.id),
  );
}
