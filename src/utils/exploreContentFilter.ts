// Thin, build-aware composition layer over the pure Explore filters.
//
// Screens (ExploreHomeScreen, EventsScreen, MapScreen, …) import from
// here so they get a single, ready-to-call API and don't each re-wire the
// `isProductionBuild()` gate. The actual logic stays in the pure,
// unit-tested helpers:
//   - isFutureEvent          (futureEvent.ts)
//   - isHiddenInProdPubkey   (testAccounts.ts)
//   - isProductionBuild      (appEnvironment.ts)

import { isProductionBuild } from './appEnvironment';
import { isHiddenInProdPubkey } from './testAccounts';
import { isFutureEvent, type EventTiming } from './futureEvent';

/**
 * Per-event / per-cache predicate: should this author's content be hidden
 * RIGHT NOW (i.e. is it a test account AND are we in production)?
 *
 * Drop-in for the relay-ingestion hot path — the build check short-circuits
 * to `false` in dev/preview so it's a single boolean read there.
 */
export const isHiddenInProd = (pubkey: string): boolean =>
  isProductionBuild() && isHiddenInProdPubkey(pubkey);

/**
 * Strip prod-hidden (test-account) items from a list before it's persisted
 * to the Explore cache, so prod caches self-heal: stale Piggy entries left
 * over from earlier versions age out of storage instead of being re-saved
 * forever and crowding out real content. In dev/preview `isHiddenInProd` is
 * always false, so the list passes through untouched.
 *
 * @param items     the list about to be persisted
 * @param getPubkey projects an item → its author hex pubkey
 */
export const stripHiddenForPersist = <T>(
  items: readonly T[],
  getPubkey: (item: T) => string,
): T[] => {
  // The build variant is constant for the process, so resolve the prod gate
  // ONCE here rather than calling `isProductionBuild()` (a native-module
  // read) per item inside the loop — relevant when persisting large cache /
  // event lists. In dev/preview this short-circuits to a pass-through.
  if (!isProductionBuild()) return [...items];
  return items.filter((item) => !isHiddenInProdPubkey(getPubkey(item)));
};

/**
 * The caches to PAINT on an Explore surface (rail + mini-map): everything
 * except prod-hidden test-account Piglets. Cold-start items hydrated from
 * AsyncStorage bypass the ingestion guard, so this is re-applied at render so
 * a stale hidden Piglet can't paint as a map marker (#917). No-op in
 * dev/preview.
 */
export const visibleCaches = <T>(items: readonly T[], getPubkey: (item: T) => string): T[] => {
  if (!isProductionBuild()) return [...items];
  return items.filter((item) => !isHiddenInProdPubkey(getPubkey(item)));
};

/**
 * The events to PAINT on an Explore surface: future-only AND (in prod) not
 * authored by a test account. Same cold-start rationale as {@link visibleCaches}
 * — a cached PAST or hidden event must not survive into the rail or mini-map.
 *
 * @param nowSeconds inject `Date.now()/1000`
 */
export const visibleEvents = <T extends EventTiming>(
  items: readonly T[],
  getPubkey: (item: T) => string,
  nowSeconds: number,
): T[] => {
  const prod = isProductionBuild();
  return items.filter(
    (item) => isFutureEvent(item, nowSeconds) && !(prod && isHiddenInProdPubkey(getPubkey(item))),
  );
};
