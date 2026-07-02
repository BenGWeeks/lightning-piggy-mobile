// Relay fetch for a merchant's kind-30406 shipping options (#948 Option A).
// Thin I/O shell over the PURE parsing/filtering in utils/marketShipping —
// query the merchant's addressable shipping-option events once per checkout
// open, newest-revision-per-d.
import { pool, trackRelays, DEFAULT_RELAYS } from './nostrService';
import { querySyncAbortable } from './relayQuery';
import {
  SHIPPING_OPTION_KIND,
  parseShippingOptionEvent,
  dedupeNewestPerD,
  type ShippingOption,
} from '../utils/marketShipping';

// One relay round-trip is plenty for a checkout sheet — cap the wait so a
// dead relay can't hold the shipping section in a spinner.
const FETCH_MAX_WAIT_MS = 6000;

/**
 * Fetch the merchant's published shipping options. Queries the given read
 * relays unioned with the defaults (the merchant's options live wherever
 * they publish, which may not overlap the buyer's relay set), parses and
 * collapses to the newest revision per `d`. Returns `[]` when the merchant
 * publishes none — the checkout then skips the shipping step entirely.
 */
export async function fetchShippingOptions(input: {
  merchantPubkey: string;
  relays: string[];
  signal?: AbortSignal;
}): Promise<ShippingOption[]> {
  const relays = Array.from(new Set([...input.relays, ...DEFAULT_RELAYS]));
  trackRelays(relays);
  const events = await querySyncAbortable(
    pool,
    relays,
    { kinds: [SHIPPING_OPTION_KIND], authors: [input.merchantPubkey] },
    { maxWait: FETCH_MAX_WAIT_MS, signal: input.signal },
  );
  const parsed = events
    .map(parseShippingOptionEvent)
    .filter((o): o is ShippingOption => o !== null);
  return dedupeNewestPerD(parsed);
}
