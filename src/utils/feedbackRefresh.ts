// Pull-to-refresh for Market product feedback (#1301). Pure — no React, no
// I/O — so the incremental-merge rules are unit-tested in isolation.
//
// A refresh doesn't re-download the whole thread: it asks relays only for
// what is newer than the newest item already loaded (minus a slack window
// for clock skew / slow relays), then folds that delta into the loaded set.
import type { Event as NostrEvent } from 'nostr-tools';
import { addressOf, deletedByAuthor } from './nip09';

/**
 * Slack subtracted from the newest loaded `created_at` for a refresh's
 * `since`. Covers a poster's clock running a little behind ours and relays
 * that receive an event late; the overlap is de-duplicated by id anyway.
 */
export const REFRESH_SINCE_SLACK_SECS = 10 * 60;

/** Loaded feedback: the events plus the author kind-5s that apply to them. */
export interface FeedbackSet {
  events: NostrEvent[];
  deletions: NostrEvent[];
}

/**
 * `since` for an incremental refresh: the newest `created_at` among `events`
 * minus the slack, or undefined when nothing is loaded yet (then the caller
 * runs its normal `limit`-bounded query). Capped at `now` so one event with a
 * future timestamp can't push `since` past everything new.
 */
export function refreshSince(
  events: readonly NostrEvent[],
  now = Math.floor(Date.now() / 1000),
  slack = REFRESH_SINCE_SLACK_SECS,
): number | undefined {
  let newest = -1;
  for (const e of events) if (e.created_at > newest) newest = e.created_at;
  return newest < 0 ? undefined : Math.max(0, Math.min(newest, now) - slack);
}

/** Union by id, first copy wins. */
function uniqueById(events: readonly NostrEvent[]): NostrEvent[] {
  const byId = new Map<string, NostrEvent>();
  for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e);
  return Array.from(byId.values());
}

/**
 * Fold a refresh's results into what is already loaded:
 *  - events and deletions are de-duplicated by id;
 *  - an addressable event (a review) replaces older versions of its address —
 *    an edit — but only a usable version displaces (`isUsable`, e.g. "parses
 *    as a review of this product"), so a newer malformed copy can't hide the
 *    author's last valid one;
 *  - events their own author deleted (kind 5, by `e` or `a`) are dropped.
 *    The deletions are kept, so a lagging relay's late copy is still hidden.
 */
export function mergeFeedback(
  loaded: FeedbackSet,
  incoming: FeedbackSet,
  isUsable: (event: NostrEvent) => boolean = () => true,
): FeedbackSet {
  const deletions = uniqueById([...loaded.deletions, ...incoming.deletions]);
  const all = uniqueById([...loaded.events, ...incoming.events]);

  // Newest usable version per address.
  const current = new Map<string, NostrEvent>();
  for (const e of all) {
    const address = addressOf(e);
    if (!address || !isUsable(e)) continue;
    const held = current.get(address);
    if (
      !held ||
      e.created_at > held.created_at ||
      (e.created_at === held.created_at && e.id < held.id)
    ) {
      current.set(address, e);
    }
  }
  const superseded = (e: NostrEvent) => {
    const address = addressOf(e);
    if (!address) return false;
    const held = current.get(address);
    return !!held && held !== e;
  };

  const kept = all.filter((e) => !superseded(e));
  const deleted = deletedByAuthor(kept, deletions);
  return { events: kept.filter((e) => !deleted.has(e.id)), deletions };
}
