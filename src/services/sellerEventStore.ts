// In-memory, per-account store of the user's own Market events (#1273).
//
// "My shop", the shop settings and the listing editor all read the same
// snapshot, so one relay fetch serves all three screens (no duplicate
// queries when navigating between them) and an event we just signed shows
// up immediately, before relays echo it back.
import type { Event } from 'nostr-tools';

interface AccountState {
  events: Map<string, Event>;
  hidden: Map<string, number>;
  /** Persisted cache + hidden set restored from storage this session. */
  restored: boolean;
  fetchedAt: number;
  version: number;
}

const accounts = new Map<string, AccountState>();
const listeners = new Set<() => void>();
const MAX_EVENTS = 1000;

function account(pubkey: string): AccountState {
  let state = accounts.get(pubkey);
  if (!state) {
    state = { events: new Map(), hidden: new Map(), restored: false, fetchedAt: 0, version: 0 };
    accounts.set(pubkey, state);
  }
  return state;
}

function changed(state: AccountState) {
  state.version += 1;
  listeners.forEach((listener) => listener());
}

export function sellerStoreState(pubkey: string): Readonly<AccountState> {
  return account(pubkey);
}

/** Merge events (fetched or just signed) into the account's set. */
export function addSellerEvents(pubkey: string, events: readonly Event[], fetched = false) {
  const state = account(pubkey);
  for (const event of events) {
    if (event.pubkey === pubkey && state.events.size < MAX_EVENTS)
      state.events.set(event.id, event);
  }
  if (fetched) state.fetchedAt = Date.now();
  changed(state);
}

export function setSellerHidden(pubkey: string, hidden: ReadonlyMap<string, number>) {
  const state = account(pubkey);
  state.hidden = new Map(hidden);
  changed(state);
}

/** Seed the account from its persisted cache (once per session). */
export function restoreSellerAccount(
  pubkey: string,
  events: readonly Event[],
  hidden: ReadonlyMap<string, number>,
) {
  const state = account(pubkey);
  if (state.restored) return;
  state.restored = true;
  for (const [coord, at] of hidden)
    state.hidden.set(coord, Math.max(state.hidden.get(coord) ?? 0, at));
  addSellerEvents(pubkey, events);
}

export function subscribeSellerStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** AsyncStorage key of the account's locally hidden (deleted) listings —
 * here, dependency-free, so the sign-out wipe can import it cheaply. */
export const sellerHiddenStorageKey = (pubkey: string) => `market-seller-hidden:${pubkey}`;
/** AsyncStorage key of the account's cached shop / zones / listings. */
export const sellerCacheStorageKey = (pubkey: string) => `market-seller-events:${pubkey}`;

/** Drop a signed-out account's in-memory events. */
export function forgetSellerAccount(pubkey: string) {
  accounts.delete(pubkey);
}

/** Test seam. */
export function resetSellerStore() {
  accounts.clear();
}
