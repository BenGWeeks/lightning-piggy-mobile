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

/**
 * Per-event / per-cache predicate: should this author's content be hidden
 * RIGHT NOW (i.e. is it a test account AND are we in production)?
 *
 * Drop-in for the relay-ingestion hot path — the build check short-circuits
 * to `false` in dev/preview so it's a single boolean read there.
 */
export const isHiddenInProd = (pubkey: string): boolean =>
  isProductionBuild() && isHiddenInProdPubkey(pubkey);
