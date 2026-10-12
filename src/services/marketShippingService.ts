// Relay fetch for a merchant's kind-30406 shipping options (#948 Option A).
// Thin I/O shell over the PURE parsing/filtering in utils/marketShipping —
// query the merchant's addressable shipping-option events once per checkout
// open, newest-revision-per-d.
import type { Event } from 'nostr-tools';
import { pool, trackRelays, DEFAULT_RELAYS } from './nostrService';
import { acquireMarketListingsPool } from './marketListingsPool';
import { verifyEventCached } from './nostrVerifyCache';
import { createYieldScheduler } from '../contexts/nostrDecryptPacing';
import { addressOf, addressRefs, deletedByAuthor, deletionFilters, idRefs } from '../utils/nip09';
import { querySyncAbortable } from './relayQuery';
import {
  SHIPPING_OPTION_KIND,
  dedupeNewestPerCoordinate,
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

/**
 * Display-only variant for the product page (#1273): shows whatever valid
 * options at the listing's referenced coordinates within the deadline. Unlike
 * {@link fetchShippingOptions} (which gates a checkout and so fails closed on
 * any timeout or malformed option), a slow relay or one bad option here just
 * drops out; only a relay set that entirely fails is an error.
 */
export async function fetchShippingOptionsForDisplay(input: {
  coordinates: readonly string[];
  relays: string[];
  signal?: AbortSignal;
}): Promise<ShippingOption[]> {
  const references = new Set(input.coordinates.filter((c) => /^30406:[a-f0-9]{64}:.+$/.test(c)));
  if (references.size === 0) return [];
  const relays = Array.from(new Set([...input.relays, ...DEFAULT_RELAYS]));
  trackRelays(relays);
  const byAuthor = new Map<string, string[]>();
  for (const coordinate of references) {
    const author = coordinate.slice(6, 70);
    const tags = byAuthor.get(author) ?? [];
    tags.push(coordinate.slice(71));
    byAuthor.set(author, tags);
  }
  const params = {
    maxWait: FETCH_MAX_WAIT_MS,
    signal: input.signal,
    rejectOnAllRelaysFailure: true,
  };
  const queries: Promise<Event[]>[] = [];
  for (const [author, tags] of byAuthor) {
    for (let i = 0; i < tags.length; i += 100) {
      queries.push(
        querySyncAbortable(
          pool,
          relays,
          {
            kinds: [SHIPPING_OPTION_KIND],
            authors: [author],
            '#d': tags.slice(i, i + 100),
            limit: 100,
          },
          params,
        ),
      );
    }
  }
  const events = (await Promise.all(queries))
    .flat()
    .filter(
      (event) => event.kind === SHIPPING_OPTION_KIND && references.has(addressOf(event) ?? ''),
    );
  // The shared pool verifies signatures synchronously during delivery. Keep
  // deletion crypto in the budget-paced loop below instead.
  const lease = acquireMarketListingsPool(relays);
  let deletions: Event[];
  try {
    deletions = (
      await Promise.all(
        [...deletionFilters('a', addressRefs(events)), ...deletionFilters('e', idRefs(events))].map(
          (filter) => querySyncAbortable(lease.pool, relays, filter, params),
        ),
      )
    ).flat();
  } finally {
    lease.release();
  }
  const scheduler = createYieldScheduler({ signal: input.signal, safetyEvery: 25 });
  const verifiedDeletions: Event[] = [];
  try {
    for (const event of deletions) {
      await scheduler.maybeYield();
      if (input.signal?.aborted) return [];
      // Ignore copied verification symbols supplied by a caller/relay.
      if (
        event.kind === 5 &&
        verifyEventCached({
          id: event.id,
          pubkey: event.pubkey,
          kind: event.kind,
          created_at: event.created_at,
          content: event.content,
          tags: event.tags,
          sig: event.sig,
        })
      )
        verifiedDeletions.push(event);
    }
  } finally {
    scheduler.dispose();
  }
  const deleted = deletedByAuthor(events, verifiedDeletions);
  const options = events
    .filter((event) => !deleted.has(event.id))
    .map(parseShippingOptionEvent)
    .filter((o): o is ShippingOption => o !== null);
  return dedupeNewestPerCoordinate(options);
}
