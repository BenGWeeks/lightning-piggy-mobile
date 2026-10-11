import { useCallback, useMemo, useState } from 'react';
import type { Event } from 'nostr-tools';
import { useNostr } from '../contexts/NostrContext';
import {
  fetchShopCollection,
  persistSellerSnapshot,
  publishSellerEvent,
  saveHiddenListings,
  sellerRelays,
} from '../services/marketSellerService';
import { addSellerEvents, sellerStoreState, setSellerHidden } from '../services/sellerEventStore';
import {
  LISTING_KIND,
  SHIPPING_OPTION_KIND,
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
import type { SellerSnapshot } from '../utils/marketSellerSnapshot';

const sameEvent = (template: EventTemplate, previous: Event | undefined) =>
  !!previous &&
  previous.content === template.content &&
  JSON.stringify(previous.tags) === JSON.stringify(template.tags);

const dTagOf = (event: Event) => event.tags.find((t) => t[0] === 'd')?.[1] ?? '';

/** Thrown by a first-time shop save when relays turn out to hold a shop the
 * snapshot hadn't loaded yet — the caller reloads the form from it. */
export class ShopExistsError extends Error {
  constructor() {
    super('Shop already exists');
    this.name = 'ShopExistsError';
  }
}

/**
 * Sign + publish the seller's Gamma Markets events through the app's signer
 * abstraction (`useNostr().signEvent` — nsec, Amber or NIP-46) to the user's
 * write relays, and drop each signed event straight into the shared store.
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

  /** Re-point the shop collection at the current listings (spec: a
   * collection lists its products). Best effort — the listing is live either
   * way, and the next shop save repairs it. */
  const republishShop = useCallback(
    async (productCoordinates: string[]) => {
      if (!pubkey || !snapshot.shop) return;
      const shop = parseShopDraft(snapshot.shop, snapshot.zones);
      if (!shop) return;
      try {
        await signAndPublish(
          buildShopTemplate({
            shop,
            pubkey,
            productCoordinates,
            zoneCoordinates: snapshot.zones.map((z) => z.coordinate),
            previous: snapshot.shop,
          }),
          snapshot.shop,
        );
      } catch (error) {
        if (__DEV__) console.warn('[Market] shop collection refresh failed:', error);
      }
    },
    [pubkey, snapshot, signAndPublish],
  );

  const listingCoordinates = useCallback(
    () =>
      pubkey ? snapshot.listings.map((e) => coordinateOf(LISTING_KIND, pubkey, dTagOf(e))) : [],
    [pubkey, snapshot.listings],
  );

  /** Products the shop collection should list: everything it already lists
   * (the loaded snapshot may be a capped cache) plus loaded listings, minus
   * anything known deleted. */
  const shopProductCoordinates = useCallback(
    (add: string[] = [], remove?: string) => {
      if (!pubkey) return [];
      const state = sellerStoreState(pubkey);
      const deleted = new Set(state.hidden.keys());
      for (const event of state.events.values()) {
        if (event.kind !== 5) continue;
        for (const t of event.tags) if (t[0] === 'a' && t[1]) deleted.add(t[1]);
      }
      const prefix = `${LISTING_KIND}:${pubkey}:`;
      const listed = (snapshot.shop?.tags ?? [])
        .filter((t) => t[0] === 'a' && t[1]?.startsWith(prefix) && !deleted.has(t[1]))
        .map((t) => t[1]);
      const all = new Set([...listingCoordinates(), ...listed, ...add]);
      if (remove) all.delete(remove);
      return [...all];
    },
    [pubkey, snapshot.shop, listingCoordinates],
  );

  const run = useCallback(async <T>(task: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await task();
    } finally {
      setBusy(false);
    }
  }, []);

  /** Save shop settings: changed zones, a deletion for the zones the user
   * removed (only ones the form was loaded with — a zone that arrived from
   * relays afterwards is kept), then the shop collection referencing them. */
  const saveShop = useCallback(
    (shop: ShopDraft, zones: ShippingZoneDraft[], baseZoneCoordinates: string[]) =>
      run(async () => {
        if (!pubkey) throw new Error('Not signed in');
        if (!snapshot.shop) {
          const found = await fetchShopCollection({ pubkey, relays: relayList });
          if (found.length > 0) {
            addSellerEvents(pubkey, found);
            void persistSellerSnapshot(pubkey);
            throw new ShopExistsError();
          }
        }
        const zoneCoordinates: string[] = [];
        for (const zone of zones) {
          const coordinate = coordinateOf(SHIPPING_OPTION_KIND, pubkey, zone.dTag);
          zoneCoordinates.push(coordinate);
          const previous = snapshot.zoneEvents.get(coordinate);
          const template = buildShippingZoneTemplate(zone, shop.currency, previous);
          if (!sameEvent(template, previous)) await signAndPublish(template, previous);
        }
        const removed = snapshot.zones.filter(
          (z) =>
            baseZoneCoordinates.includes(z.coordinate) && !zoneCoordinates.includes(z.coordinate),
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
        // Zones published elsewhere after the form loaded stay referenced.
        const kept = snapshot.zones
          .map((z) => z.coordinate)
          .filter((c) => !baseZoneCoordinates.includes(c) && !zoneCoordinates.includes(c));
        await signAndPublish(
          buildShopTemplate({
            shop,
            pubkey,
            productCoordinates: shopProductCoordinates(),
            zoneCoordinates: [...zoneCoordinates, ...kept],
            previous: snapshot.shop,
          }),
          snapshot.shop,
        );
      }),
    [pubkey, snapshot, relayList, signAndPublish, shopProductCoordinates, run],
  );

  /** Create or edit (same `d`) a listing. */
  const saveListing = useCallback(
    (draft: ListingDraft, previous: Event | null) =>
      run(async () => {
        if (!pubkey) throw new Error('Not signed in');
        const signed = await signAndPublish(
          buildListingTemplate({
            draft,
            pubkey,
            nowSeconds: Math.floor(Date.now() / 1000),
            previous,
          }),
          previous,
        );
        const coordinate = coordinateOf(LISTING_KIND, pubkey, draft.dTag);
        const known = listingCoordinates();
        if (!known.includes(coordinate)) await republishShop(shopProductCoordinates([coordinate]));
        return signed;
      }),
    [pubkey, signAndPublish, listingCoordinates, shopProductCoordinates, republishShop, run],
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
        await republishShop(shopProductCoordinates([], coordinate));
      }),
    [pubkey, signAndPublish, shopProductCoordinates, republishShop, run],
  );

  return { busy, saveShop, saveListing, deleteListing };
}
