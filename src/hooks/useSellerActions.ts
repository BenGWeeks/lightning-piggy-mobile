import { useCallback, useMemo, useState } from 'react';
import type { Event } from 'nostr-tools';
import { useNostr } from '../contexts/NostrContext';
import {
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

  const run = useCallback(async <T>(task: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await task();
    } finally {
      setBusy(false);
    }
  }, []);

  /** Save shop settings: changed zones, a deletion for removed zones, then
   * the shop collection referencing them all. */
  const saveShop = useCallback(
    (shop: ShopDraft, zones: ShippingZoneDraft[]) =>
      run(async () => {
        if (!pubkey) throw new Error('Not signed in');
        const zoneCoordinates: string[] = [];
        for (const zone of zones) {
          const coordinate = coordinateOf(SHIPPING_OPTION_KIND, pubkey, zone.dTag);
          zoneCoordinates.push(coordinate);
          const previous = snapshot.zoneEvents.get(coordinate);
          const template = buildShippingZoneTemplate(zone, shop.currency, previous);
          if (!sameEvent(template, previous)) await signAndPublish(template, previous);
        }
        const removed = snapshot.zones.filter((z) => !zoneCoordinates.includes(z.coordinate));
        if (removed.length > 0) {
          await signAndPublish(
            buildDeletionTemplate(
              removed.map((z) => ({ kind: SHIPPING_OPTION_KIND, coordinate: z.coordinate })),
            ),
          );
        }
        await signAndPublish(
          buildShopTemplate({
            shop,
            pubkey,
            productCoordinates: listingCoordinates(),
            zoneCoordinates,
            previous: snapshot.shop,
          }),
          snapshot.shop,
        );
      }),
    [pubkey, snapshot, signAndPublish, listingCoordinates, run],
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
        if (!known.includes(coordinate)) await republishShop([coordinate, ...known]);
        return signed;
      }),
    [pubkey, signAndPublish, listingCoordinates, republishShop, run],
  );

  /** NIP-09 delete + hide locally until relays catch up. */
  const deleteListing = useCallback(
    (event: Event) =>
      run(async () => {
        if (!pubkey) throw new Error('Not signed in');
        const coordinate = coordinateOf(LISTING_KIND, pubkey, dTagOf(event));
        const deletion = await signAndPublish(
          buildDeletionTemplate([{ kind: LISTING_KIND, coordinate, eventId: event.id }]),
        );
        const hidden = new Map(sellerStoreState(pubkey).hidden);
        hidden.set(coordinate, Math.max(deletion.created_at, event.created_at));
        setSellerHidden(pubkey, hidden);
        await saveHiddenListings(pubkey, hidden);
        void persistSellerSnapshot(pubkey);
        await republishShop(listingCoordinates().filter((c) => c !== coordinate));
      }),
    [pubkey, signAndPublish, listingCoordinates, republishShop, run],
  );

  return { busy, saveShop, saveListing, deleteListing };
}
