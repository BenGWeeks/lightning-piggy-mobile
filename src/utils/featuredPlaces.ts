/**
 * featuredPlaces — shared "featured-first, capped at 3" ordering for the
 * Bitcoin-accepting places surfaces.
 *
 * Both the Explore "Places near you" rail (`ExploreHomeScreen`) and the full
 * Places list (`PlacesScreen`) want the same behaviour: up to three "featured"
 * (BTC Map boosted) places pinned to the very top — even when a non-featured
 * place is physically closer — followed by the rest of the list in whatever
 * order the caller already chose (typically nearest-first by distance).
 *
 * Keeping this here (rather than inlining a `.sort()` on each screen) means:
 *   - the 3-featured cap is defined in exactly one place, and
 *   - the ordering is a pure function that can be unit-tested without a
 *     renderer or GPS fix.
 *
 * The function is generic over the row shape so it can wrap the
 * `{ place, distance }` rows both screens build. The caller passes a predicate
 * that says whether a given row is featured (e.g. `(r) => isBoosted(r.place)`).
 */

/** Maximum number of featured places pinned to the top of a places surface. */
export const MAX_FEATURED_PLACES = 3;

/**
 * Returns a new array with up to `maxFeatured` featured items (defaulting to
 * {@link MAX_FEATURED_PLACES}) pinned to the front, followed by every remaining
 * item in its original relative order.
 *
 * Notes:
 *   - Input order is preserved within each group, so callers should pass items
 *     already sorted the way they want the "normal" remainder to read (e.g. by
 *     distance). The featured block is taken in that same input order, so the
 *     nearest featured places win the (up to) `maxFeatured` slots.
 *   - A featured place that doesn't make the top-3 cap falls back into the
 *     remainder at its natural position — it is never dropped, just no longer
 *     pinned.
 *   - No item is ever duplicated: each input item appears exactly once.
 *
 * @param items     rows to order
 * @param isFeatured predicate identifying a featured row
 * @param maxFeatured cap on pinned featured rows (defaults to 3)
 */
export function orderFeaturedFirst<T>(
  items: readonly T[],
  isFeatured: (item: T) => boolean,
  maxFeatured: number = MAX_FEATURED_PLACES,
): T[] {
  if (items.length === 0) return [];

  const pinned: T[] = [];
  const rest: T[] = [];

  for (const item of items) {
    if (isFeatured(item) && pinned.length < maxFeatured) {
      pinned.push(item);
    } else {
      // Either not featured, or featured-but-over-cap: keep it in the
      // remainder at its natural (caller-supplied) position so it isn't
      // duplicated and isn't dropped.
      rest.push(item);
    }
  }

  return [...pinned, ...rest];
}
