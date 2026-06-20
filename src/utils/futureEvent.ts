// Pure helpers for the Explore "Events near you" surfaces:
//   1. isFutureEvent  — should a calendar event still be shown, or is it
//                       in the past?
//   2. hideTestContentInProd — strip the project's own test-account
//                       content from a list, but only in production.
//
// Both are pure (no Date.now(), no native modules) so they unit-test
// trivially: the caller injects `now` / `isProd`.

/** Minimal shape `isFutureEvent` needs — a subset of `ParsedEvent`. */
export interface EventTiming {
  /** Unix-seconds start, or null when the publisher omitted `start`. */
  startsAt: number | null;
  /** Unix-seconds end, or null when the publisher omitted `end`. */
  endsAt: number | null;
}

// All-day / date-based events (NIP-52 kind 31922) are published with a
// `start` pinned to midnight. A start that lands exactly on a day boundary
// is treated as all-day: it stays "not past" until the END of that day, so
// an all-day event happening *today* still shows up all day rather than
// disappearing at 00:00. 24h in seconds.
const ONE_DAY_SECONDS = 24 * 60 * 60;

/**
 * Is this event upcoming (or in progress) rather than finished?
 *
 * Rules, in order:
 *   - No timing at all (start AND end null) → KEEP. We can't prove it's
 *     past, and "Time TBA" events are legitimately future-leaning; better
 *     to show than to silently drop.
 *   - Has an `end` → future iff `end >= now` (an event that started
 *     yesterday but ends tomorrow is still happening, so it's shown).
 *   - Has only a `start`:
 *       · all-day (start on a midnight boundary) → future until the end of
 *         the start day (`start + 1 day >= now`), so a today all-day event
 *         survives the whole day.
 *       · timed → future iff `start >= now`. (No grace window — past is
 *         past. The old code's 1h grace let "17 May" style events linger.)
 *
 * @param event the event's start/end timestamps (unix seconds)
 * @param nowSeconds current time in unix SECONDS (inject `Date.now()/1000`)
 */
export const isFutureEvent = (event: EventTiming, nowSeconds: number): boolean => {
  const { startsAt, endsAt } = event;

  if (startsAt === null && endsAt === null) return true;

  if (endsAt !== null) {
    return endsAt >= nowSeconds;
  }

  // start-only from here.
  const start = startsAt as number;
  const isAllDay = start % ONE_DAY_SECONDS === 0;
  if (isAllDay) {
    return start + ONE_DAY_SECONDS >= nowSeconds;
  }
  return start >= nowSeconds;
};

/**
 * In PRODUCTION builds, remove items authored by the project's test
 * accounts (the "Piggies"). In any other build the list passes through
 * untouched so Maestro / internal testers still see the fixtures.
 *
 * Generic over the item shape: the caller supplies a `getPubkey`
 * projection so the same helper covers both NIP-52 events
 * (`e.organiserPubkey`) and NIP-GC caches / Piglets (`c.hiderPubkey`).
 *
 * @param items     the list to filter
 * @param getPubkey projects an item → its author hex pubkey
 * @param isHidden  membership test (e.g. `isHiddenInProdPubkey`)
 * @param isProd    true only in the production build (`isProductionBuild()`)
 */
export const hideTestContentInProd = <T>(
  items: readonly T[],
  getPubkey: (item: T) => string,
  isHidden: (pubkey: string) => boolean,
  isProd: boolean,
): T[] => {
  if (!isProd) return [...items];
  return items.filter((item) => !isHidden(getPubkey(item)));
};
