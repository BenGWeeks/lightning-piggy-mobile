// Gate for the in-app Market checkout (#948): decides whether "Buy" places a
// NIP-17 order or opens the seller's website.
//
// A seller having an npub is NOT proof they accept in-app orders — the order
// references a listing id and a price the seller's order service must
// recognise. So checkout requires the product's explicit `checkout` opt-in
// (the seller's real listing `d` tag + fulfilment) AND a decodable merchant
// pubkey to address the order to. Anything short of both → website.
//
// No React, no I/O (coverage scope: src/utils).
import type { MarketProduct, MarketProductCheckout } from '../data/marketProducts';
import type { MarketVendor } from '../data/marketVendors';
import { vendorNostrPubkey } from './marketVendors';

export interface MarketCheckoutTarget extends MarketProductCheckout {
  /** Seller's Nostr pubkey (hex) — the order recipient. */
  vendorPubkey: string;
}

/** The in-app checkout target for `product`, or null to use the website. */
export function marketCheckoutTarget(
  product: MarketProduct,
  vendor: MarketVendor | undefined,
): MarketCheckoutTarget | null {
  const checkout = product.checkout;
  if (!checkout || !vendor) return null;
  const listingDTag = checkout.listingDTag.trim();
  if (!listingDTag) return null;
  if (checkout.fulfilment !== 'physical' && checkout.fulfilment !== 'none') return null;
  const vendorPubkey = vendorNostrPubkey(vendor);
  if (!vendorPubkey) return null;
  return { vendorPubkey, listingDTag, fulfilment: checkout.fulfilment };
}
