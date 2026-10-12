import type { Event } from 'nostr-tools';
import type { EventTemplate } from '../utils/marketSellerEvents';
import { createYieldScheduler } from '../contexts/nostrDecryptPacing';

/** Remove withdrawn zone tags from current listing revisions, preserving
 * physical product type, surcharges on other zones, and all unknown tags.
 * Always read the latest revision so a shop edit cannot overwrite a listing
 * edited on another device. Fetch/publish failures propagate for retry. */
export async function removeWithdrawnShippingReferences(input: {
  coordinates: ReadonlySet<string>;
  listings: readonly Event[];
  latest: (listing: Event) => Promise<Event | null>;
  publish: (template: EventTemplate, previous: Event) => Promise<Event>;
}): Promise<void> {
  const affected = (event: Event) =>
    event.tags.some((tag) => tag[0] === 'shipping_option' && input.coordinates.has(tag[1]));
  const scheduler = createYieldScheduler({ safetyEvery: 25 });
  try {
    for (const listing of input.listings) {
      await scheduler.maybeYield();
      const current = await input.latest(listing);
      if (!current || !affected(current)) continue;
      await input.publish(
        {
          kind: current.kind,
          content: current.content,
          tags: current.tags.filter(
            (tag) => tag[0] !== 'shipping_option' || !input.coordinates.has(tag[1]),
          ),
        },
        current,
      );
    }
  } finally {
    scheduler.dispose();
  }
}
