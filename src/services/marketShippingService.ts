// Relay fetch for a merchant's kind-30406 shipping options (#948 Option A).
// Thin I/O shell over the PURE parsing/filtering in utils/marketShipping —
// query the merchant's addressable shipping-option events once per checkout
// open, newest-revision-per-d.
import { pool, trackRelays, DEFAULT_RELAYS } from './nostrService';
import { querySyncAbortable } from './relayQuery';
import {
  SHIPPING_OPTION_KIND,
  parseShippingOptionEvent,
  type ShippingOption,
} from '../utils/marketShipping';

// One relay round-trip is plenty for a checkout sheet — cap the wait so a
// dead relay can't hold the shipping section in a spinner.
const FETCH_MAX_WAIT_MS = 6000;

/**
 * Fetch the merchant's published shipping options. Queries the given read
 * relays unioned with the defaults (the merchant's options live wherever
 * they publish, which may not overlap the buyer's relay set), parses and
 * collapses to the newest revision per `d`. An unfinished relay query is an
 * error, never an empty shipping list. A completed empty query returns `[]`;
 * physical products still require an explicit shipping option in the hook.
 */
export async function fetchShippingOptions(input: {
  merchantPubkey: string;
  relays: string[];
  signal?: AbortSignal;
}): Promise<ShippingOption[]> {
  const relays = Array.from(new Set([...input.relays, ...DEFAULT_RELAYS]));
  trackRelays(relays);
  const merchantPubkey = input.merchantPubkey.trim().toLowerCase();
  const events = await querySyncAbortable(
    pool,
    relays,
    { kinds: [SHIPPING_OPTION_KIND], authors: [merchantPubkey], limit: 100 },
    // An unreachable relay set must surface as an ERROR (retry row, submit
    // blocked), including a connected relay that never completes its response.
    {
      maxWait: FETCH_MAX_WAIT_MS,
      signal: input.signal,
      rejectOnAllRelaysFailure: true,
      rejectOnTimeout: true,
    },
  );
  // The `authors` filter is only a relay-side request; a misbehaving relay can
  // still hand back a valid-looking 30406 from another pubkey, whose price
  // would otherwise become a shipping charge on THIS merchant's order. Drop
  // anything not signed by the merchant before parsing.
  // Likewise `kinds` — an unrelated merchant event of another kind is simply
  // not a shipping option, not a malformed one.
  const shippingEvents = events.filter((ev) => ev.kind === SHIPPING_OPTION_KIND);
  const own = shippingEvents.filter((ev) => ev.pubkey.toLowerCase() === merchantPubkey);
  // A response that holds 30406s but NONE from the merchant isn't "the
  // merchant publishes no options" — it's a relay serving someone else's.
  // Fail closed rather than let it read as a digital-goods checkout.
  if (own.length === 0 && shippingEvents.length > 0) {
    throw new Error('Relay returned shipping options from another pubkey only');
  }
  // Invalid options must not turn into an empty list ("no shipping needed").
  const newest = new Map<string, (typeof own)[number]>();
  for (const event of own) {
    const d = event.tags.find((tag) => tag[0] === 'd')?.[1];
    if (!d) throw new Error('Merchant returned invalid shipping options');
    const previous = newest.get(d);
    if (
      !previous ||
      event.created_at > previous.created_at ||
      (event.created_at === previous.created_at && event.id < previous.id)
    )
      newest.set(d, event);
  }
  const parsed = [...newest.values()].map(parseShippingOptionEvent);
  if (parsed.some((option) => option === null)) {
    throw new Error('Merchant returned invalid shipping options');
  }
  return parsed as ShippingOption[];
}
