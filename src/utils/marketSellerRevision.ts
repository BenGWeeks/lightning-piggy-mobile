// Pre-publish revision check for the seller's own addressable events
// (#1273). PURE (the fetch is injected) so the fail-closed rules are tested.
//
// Before an edit is signed, the CURRENT revision is fetched:
// - a fetch that fails or times out → SellerFetchError, nothing published
//   (a relay timeout must never read as "no shop" and let a blank setup
//   replace the real one);
// - a revision newer than the one the form was loaded from (or any shop when
//   the form thought there was none) → StaleRevisionError, nothing published,
//   unless the user confirmed with `force`;
// - otherwise the newest known revision is returned as the edit's base, so
//   tags we don't manage are kept from it.
import type { Event } from 'nostr-tools';

export interface SaveOptions {
  /** Publish even though a newer revision exists (user confirmed). */
  force?: boolean;
}

/** Relays couldn't confirm the current revision (timeout / all failed). */
export class SellerFetchError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Could not reach relays');
    this.name = 'SellerFetchError';
  }
}

/** A newer revision than the form's base exists. `latest` is the newest. */
export class StaleRevisionError extends Error {
  constructor(
    readonly latest: Event,
    readonly base: Event | null,
  ) {
    super('A newer revision exists');
    this.name = 'StaleRevisionError';
  }
}

/** NIP-01 replaceable ordering: newer created_at, then lower id. */
export const isNewerRevision = (a: Event, b: Event | null): boolean =>
  !b || a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);

export async function resolveCurrentRevision(input: {
  fetchLatest: () => Promise<Event | null>;
  base: Event | null;
  force?: boolean;
  onLatest?: (latest: Event) => void;
}): Promise<Event | null> {
  let latest: Event | null;
  try {
    latest = await input.fetchLatest();
  } catch (error) {
    throw new SellerFetchError(error);
  }
  if (latest) input.onLatest?.(latest);
  const { base } = input;
  if (latest && latest.id !== base?.id && isNewerRevision(latest, base)) {
    if (!input.force) throw new StaleRevisionError(latest, base);
    return latest;
  }
  // Relays may lag our own just-published base: keep whichever is newer.
  if (base && latest) return isNewerRevision(base, latest) ? base : latest;
  return latest ?? base;
}
