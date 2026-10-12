import { signSellerMutation } from '../utils/sellerSigning';
import { useCallback, useMemo, useRef, useState } from 'react';
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
  zoneEvents: Map<string, Event>;
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
  const identity = useRef({ pubkey, signEvent });
  if (identity.current.pubkey !== pubkey || identity.current.signEvent !== signEvent) {
    identity.current = { pubkey, signEvent };
  }
  const initiatingIdentity = identity.current;
  const relayList = useMemo(() => sellerRelays(relays), [relays]);
  const [busy, setBusy] = useState(false);

  const signAndPublish = useCallback(
    async (
      template: EventTemplate,
      previous?: Pick<Event, 'created_at'> | null,
    ): Promise<Event> => {
      if (!pubkey) throw new Error('Not signed in');
      const signed = await signSellerMutation({
        pubkey,
        template: { ...template, created_at: nextCreatedAt(Date.now() / 1000, previous) },
        isCurrent: () => identity.current === initiatingIdentity,
        sign: async (event) => (await signEvent(event)) as Event | null,
      });
      await publishSellerEvent(signed, relayList);
      addSellerEvents(pubkey, [signed]);
      void persistSellerSnapshot(pubkey);
      return signed;
    },
    [pubkey, signEvent, relayList, initiatingIdentity],
  );

  /** The current revision to build on, or throw (fetch failure / newer
   * revision than `base` without `force`). */
  const currentRevision = useCallback(
    (
      kind: number,
      dTag: string,
      base: Event | null,
      options: SaveOptions = {},
      onDeletedAt?: (deletedAt: number) => void,
    ) => {
      if (!pubkey) throw new Error('Not signed in');
      return resolveCurrentRevision({
        fetchLatest: () =>
          fetchLatestRevision({ pubkey, kind, dTag, baseId: base?.id, relays: relayList }),
        base,
        force: options.force,
        onDeletedAt,
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
        const zoneCoordinates = zones.map((z) =>
          coordinateOf(SHIPPING_OPTION_KIND, pubkey, z.dTag),
        );
        const removed = base.zoneCoordinates.filter((c) => !zoneCoordinates.includes(c));
        // Complete every conflict check before publishing the first mutation.
        const revisions = new Map<string, Event | null>();
        for (const coordinate of new Set([...zoneCoordinates, ...removed])) {
          revisions.set(
            coordinate,
            await currentRevision(
              SHIPPING_OPTION_KIND,
              coordinate.split(':').slice(2).join(':'),
              base.zoneEvents.get(coordinate) ?? null,
              options,
            ),
          );
        }
        for (const zone of zones) {
          const coordinate = coordinateOf(SHIPPING_OPTION_KIND, pubkey, zone.dTag);
          const previous = revisions.get(coordinate) ?? null;
          const template = buildShippingZoneTemplate(zone, previous ?? undefined);
          if (!sameEvent(template, previous ?? undefined)) await signAndPublish(template, previous);
        }
        if (removed.length > 0) {
          const newest = Math.max(0, ...removed.map((c) => revisions.get(c)?.created_at ?? 0));
          await signAndPublish(
            buildDeletionTemplate(
              removed.map((coordinate) => ({
                kind: SHIPPING_OPTION_KIND,
                coordinate,
                eventId: revisions.get(coordinate)?.id,
              })),
            ),
            { created_at: newest - 1 } as Event,
          );
        }
        const removedSet = new Set(removed);
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
        let deletedAt = -1;
        const current = base
          ? await currentRevision(LISTING_KIND, draft.dTag, base, options, (timestamp) => {
              deletedAt = timestamp;
            })
          : null;
        const signed = await signAndPublish(
          buildListingTemplate({
            draft,
            pubkey,
            nowSeconds: Math.floor(Date.now() / 1000),
            previous: current,
          }),
          // Address deletions suppress every revision at or before their
          // timestamp, even when the latest surviving revision is null.
          { created_at: Math.max(current?.created_at ?? -1, deletedAt) },
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
