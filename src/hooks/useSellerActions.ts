import { useCallback, useMemo, useState } from 'react';
import type { Event } from 'nostr-tools';
import { useNostr } from '../contexts/NostrContext';
import {
  fetchLatestRevision,
  persistSellerSnapshot,
  publishSellerEvent,
  saveHiddenListings,
  sellerRelays,
} from '../services/marketSellerService';
import { addSellerEvents, sellerStoreState, setSellerHidden } from '../services/sellerEventStore';
import {
  COLLECTION_KIND,
  LISTING_KIND,
  SHIPPING_OPTION_KIND,
  SHOP_COLLECTION_D,
  buildDeletionTemplate,
  buildListingTemplate,
  buildShippingZoneTemplate,
  buildShopTemplate,
  coordinateOf,
  nextCreatedAt,
  parseShopDraft,
  type EventTemplate,
  type ListingDraft,
  type ShippingZoneDraft,
  type ShopDraft,
} from '../utils/marketSellerEvents';
import { resolveCurrentRevision, type SaveOptions } from '../utils/marketSellerRevision';
import type { SellerSnapshot } from '../utils/marketSellerSnapshot';

export {
  SellerFetchError,
  StaleRevisionError,
  type SaveOptions,
} from '../utils/marketSellerRevision';

const sameEvent = (template: EventTemplate, previous: Event | undefined) =>
  !!previous &&
  previous.content === template.content &&
  JSON.stringify(previous.tags) === JSON.stringify(template.tags);

const dTagOf = (event: Event) => event.tags.find((t) => t[0] === 'd')?.[1] ?? '';

/** What the shop form was loaded from. */
export interface ShopBase {
  shop: Event | null;
  zoneCoordinates: string[];
}

/**
 * Sign + publish the seller's Gamma Markets events through the app's signer
 * abstraction (`useNostr().signEvent` — nsec, Amber or NIP-46) to the user's
 * write relays, and drop each signed event straight into the shared store.
 *
 * Every edit first fetches the CURRENT revision (fail closed) so a cached or
 * stale form can't silently overwrite newer data published elsewhere.
 */
export function useSellerActions(snapshot: SellerSnapshot) {
  const { pubkey, relays, signEvent } = useNostr();
  const relayList = useMemo(() => sellerRelays(relays), [relays]);
  const [busy, setBusy] = useState(false);

  const signAndPublish = useCallback(
    async (template: EventTemplate, previous?: Event | null): Promise<Event> => {
      if (!pubkey) throw new Error('Not signed in');
      const signed = (await signEvent({
        ...template,
        created_at: nextCreatedAt(Date.now() / 1000, previous),
      })) as Event | null;
      if (!signed) throw new Error('Not signed in');
      await publishSellerEvent(signed, relayList);
      addSellerEvents(pubkey, [signed]);
      void persistSellerSnapshot(pubkey);
      return signed;
    },
    [pubkey, signEvent, relayList],
  );

  /** The current revision to build on, or throw (fetch failure / newer
   * revision than `base` without `force`). */
  const currentRevision = useCallback(
    (kind: number, dTag: string, base: Event | null, options: SaveOptions = {}) => {
      if (!pubkey) throw new Error('Not signed in');
      return resolveCurrentRevision({
        fetchLatest: () => fetchLatestRevision({ pubkey, kind, dTag, relays: relayList }),
        base,
        force: options.force,
        onLatest: (latest) => addSellerEvents(pubkey, [latest]),
      });
    },
    [pubkey, relayList],
  );

  const listingCoordinates = useCallback(
    () =>
      pubkey ? snapshot.listings.map((e) => coordinateOf(LISTING_KIND, pubkey, dTagOf(e))) : [],
    [pubkey, snapshot.listings],
  );

  /** Products the shop collection should list: everything `shopEvent`
   * already lists (the loaded snapshot may be a capped cache) plus loaded
   * listings, minus anything known deleted. */
  const shopProductCoordinates = useCallback(
    (shopEvent: Event | null, add: string[] = [], remove?: string) => {
      if (!pubkey) return [];
      const state = sellerStoreState(pubkey);
      const deleted = new Set(state.hidden.keys());
      for (const event of state.events.values()) {
        if (event.kind !== 5) continue;
        for (const t of event.tags) if (t[0] === 'a' && t[1]) deleted.add(t[1]);
      }
      const prefix = `${LISTING_KIND}:${pubkey}:`;
      const listed = (shopEvent?.tags ?? [])
        .filter((t) => t[0] === 'a' && t[1]?.startsWith(prefix) && !deleted.has(t[1]))
        .map((t) => t[1]);
      const all = new Set([...listingCoordinates(), ...listed, ...add]);
      if (remove) all.delete(remove);
      return [...all];
    },
    [pubkey, listingCoordinates],
  );

  /** Re-point the shop collection at its products after a listing is
   * created or deleted. Best effort — the listing change is live either way,
   * and it never publishes over a shop revision it couldn't fetch. */
  const republishShop = useCallback(
    async (add: string[], remove?: string) => {
      if (!pubkey || !snapshot.shop) return;
      try {
        const latest = await currentRevision(COLLECTION_KIND, SHOP_COLLECTION_D, snapshot.shop, {
          force: true,
        });
        const shop = latest ? parseShopDraft(latest, snapshot.zones) : null;
        if (!latest || !shop) return;
        const zoneRefs = latest.tags.filter((t) => t[0] === 'shipping_option').map((t) => t[1]);
        await signAndPublish(
          buildShopTemplate({
            shop,
            pubkey,
            productCoordinates: shopProductCoordinates(latest, add, remove),
            zoneCoordinates: zoneRefs,
            previous: latest,
          }),
          latest,
        );
      } catch (error) {
        if (__DEV__) console.warn('[Market] shop collection refresh failed:', error);
      }
    },
    [
      pubkey,
      snapshot.shop,
      snapshot.zones,
      currentRevision,
      signAndPublish,
      shopProductCoordinates,
    ],
  );

  const run = useCallback(async <T>(task: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await task();
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Save shop settings: changed zones, a deletion for the zones the user
   * removed (only ones the form was loaded with), then the shop collection.
   * The collection keeps every zone / product reference of the CURRENT shop
   * that the form didn't explicitly remove (zones that failed to parse, or
   * were added elsewhere after the form loaded).
   */
  const saveShop = useCallback(
    (shop: ShopDraft, zones: ShippingZoneDraft[], base: ShopBase, options: SaveOptions = {}) =>
      run(async () => {
        if (!pubkey) throw new Error('Not signed in');
        const current = await currentRevision(
          COLLECTION_KIND,
          SHOP_COLLECTION_D,
          base.shop,
          options,
        );
        const zoneCoordinates: string[] = [];
        for (const zone of zones) {
          const coordinate = coordinateOf(SHIPPING_OPTION_KIND, pubkey, zone.dTag);
          zoneCoordinates.push(coordinate);
          const previous = snapshot.zoneEvents.get(coordinate);
          const template = buildShippingZoneTemplate(zone, previous);
          if (!sameEvent(template, previous)) await signAndPublish(template, previous);
        }
        const removed = snapshot.zones.filter(
          (z) =>
            base.zoneCoordinates.includes(z.coordinate) && !zoneCoordinates.includes(z.coordinate),
        );
        if (removed.length > 0) {
          // Dated no earlier than the newest revision it deletes (NIP-09).
          const newest = Math.max(...removed.map((z) => z.createdAt));
          await signAndPublish(
            buildDeletionTemplate(
              removed.map((z) => ({
                kind: SHIPPING_OPTION_KIND,
                coordinate: z.coordinate,
                eventId: snapshot.zoneEvents.get(z.coordinate)?.id,
              })),
            ),
            { created_at: newest - 1 } as Event,
          );
        }
        const removedSet = new Set(removed.map((z) => z.coordinate));
        const kept = [
          ...(current?.tags ?? []).filter((t) => t[0] === 'shipping_option').map((t) => t[1]),
          ...snapshot.zones.map((z) => z.coordinate),
        ].filter(
          (c) =>
            !!c &&
            !zoneCoordinates.includes(c) &&
            !base.zoneCoordinates.includes(c) &&
            !removedSet.has(c),
        );
        await signAndPublish(
          buildShopTemplate({
            shop,
            pubkey,
            productCoordinates: shopProductCoordinates(current),
            zoneCoordinates: [...new Set([...zoneCoordinates, ...kept])],
            previous: current,
          }),
          current,
        );
      }),
    [pubkey, snapshot, currentRevision, signAndPublish, shopProductCoordinates, run],
  );

  /** Create or edit (same `d`) a listing. */
  const saveListing = useCallback(
    (draft: ListingDraft, base: Event | null, options: SaveOptions = {}) =>
      run(async () => {
        if (!pubkey) throw new Error('Not signed in');
        const current = base
          ? await currentRevision(LISTING_KIND, draft.dTag, base, options)
          : null;
        const signed = await signAndPublish(
          buildListingTemplate({
            draft,
            pubkey,
            nowSeconds: Math.floor(Date.now() / 1000),
            previous: current,
          }),
          current,
        );
        const coordinate = coordinateOf(LISTING_KIND, pubkey, draft.dTag);
        if (!listingCoordinates().includes(coordinate)) await republishShop([coordinate]);
        return signed;
      }),
    [pubkey, currentRevision, signAndPublish, listingCoordinates, republishShop, run],
  );

  /** NIP-09 delete + hide locally until relays catch up. */
  const deleteListing = useCallback(
    (event: Event) =>
      run(async () => {
        if (!pubkey) throw new Error('Not signed in');
        const coordinate = coordinateOf(LISTING_KIND, pubkey, dTagOf(event));
        // `previous = event` dates the deletion after the revision it deletes.
        const deletion = await signAndPublish(
          buildDeletionTemplate([{ kind: LISTING_KIND, coordinate, eventId: event.id }]),
          event,
        );
        const hidden = new Map(sellerStoreState(pubkey).hidden);
        hidden.set(coordinate, Math.max(deletion.created_at, event.created_at));
        setSellerHidden(pubkey, hidden);
        await saveHiddenListings(pubkey, hidden);
        void persistSellerSnapshot(pubkey);
        await republishShop([], coordinate);
      }),
    [pubkey, signAndPublish, republishShop, run],
  );

  return { busy, saveShop, saveListing, deleteListing };
}
