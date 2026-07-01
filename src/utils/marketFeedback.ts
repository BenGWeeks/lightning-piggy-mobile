// Bridges the hardcoded Market catalogue to the Nostr feedback libraries:
// resolves a product + its seller into the coordinates that reviews (kind
// 31555) and comments (kind 1111) are rooted on.
//
// A product's Nostr identity is (merchant pubkey, product dTag) where the
// dTag is the product's stable `id` (mirroring how the companion website's
// NIP-99 kind-30402 listings key their `d` tag on the product id). Sellers
// WITHOUT a Nostr identity (`vendorNostrPubkey` -> null) can't be rooted on a
// real 30402 coordinate, so feedback is unavailable for them and this returns
// null — the detail screen then hides the review/comment tabs for that seller.
//
// No React, no I/O (coverage scope: src/utils).
import type { Event as NostrEvent } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import type { MarketVendor } from '../data/marketVendors';
import { vendorNostrPubkey } from './marketVendors';
import { PRODUCT_KIND, productReviewCoord } from './productReviews';

/** Everything needed to query + publish reviews and comments for a product. */
export interface MarketFeedbackContext {
  /** Seller's Nostr pubkey (hex). */
  merchantPubkey: string;
  /** The product's addressable `d` tag (its stable id). */
  productDTag: string;
  /** Review coordinate `a:30402:<merchant>:<dTag>` (reviews root on `#d`). */
  reviewCoord: string;
  /**
   * Synthetic kind-30402 product "event" used as the comment thread root.
   * Only `kind`, `pubkey` and the `d` tag are load-bearing (the comment
   * helpers read those); the id/sig are empty because the LP catalogue is
   * curated, not a live relay event.
   */
  commentRoot: NostrEvent;
}

/**
 * Resolve the review/comment coordinates for a product sold by `vendor`, or
 * null when the seller has no Nostr identity to root feedback on.
 */
export function marketFeedbackContext(
  product: MarketProduct,
  vendor: MarketVendor | undefined,
): MarketFeedbackContext | null {
  if (!vendor) return null;
  const merchantPubkey = vendorNostrPubkey(vendor);
  if (!merchantPubkey) return null;

  const productDTag = product.id;
  const commentRoot = {
    id: '',
    pubkey: merchantPubkey,
    kind: PRODUCT_KIND,
    tags: [['d', productDTag]],
    content: '',
    created_at: 0,
    sig: '',
  } as NostrEvent;

  return {
    merchantPubkey,
    productDTag,
    reviewCoord: productReviewCoord(merchantPubkey, productDTag),
    commentRoot,
  };
}
