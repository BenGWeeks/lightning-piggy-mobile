// NIP-09 deletion requests (kind 5), read side — shared by Market comments
// and reviews (#1272). Pure, no I/O.
//
// A kind-5 names what it deletes by `e` (one event id) and/or `a` (an
// addressable coordinate `<kind>:<pubkey>:<d>` — every version of it up to
// the deletion's `created_at`). It only counts when the deletion's author is
// the deleted event's author; anyone else's kind-5 changes nothing.
import type { Event as NostrEvent, Filter } from 'nostr-tools';

/** NIP-09 deletion request kind. */
export const DELETION_KIND = 5;
/** Values per kind-5 lookup — keeps each relay REQ's tag list small. */
export const DELETION_QUERY_CHUNK = 100;

/** Addressable (parameterised replaceable): 30000 <= kind < 40000. */
const isAddressable = (kind: number) => kind >= 30000 && kind < 40000;

/** `<kind>:<pubkey>:<d>` for an addressable event, else null. */
export function addressOf(event: NostrEvent): string | null {
  if (!isAddressable(event.kind)) return null;
  const d = event.tags.find(([name]) => name === 'd')?.[1] ?? '';
  return `${event.kind}:${event.pubkey}:${d}`;
}

/** Something a kind-5 may name: an event id or address, and its author. */
export interface DeletionRef {
  value: string;
  author: string;
}

/**
 * Bounded relay filters fetching kind-5s that name `refs` by `#e` / `#a`.
 * Restricted to the referenced events' AUTHORS — only their deletions count,
 * and without it anyone's junk kind-5s could crowd the real one out of the
 * `limit`.
 */
export function deletionFilters(tag: 'e' | 'a', refs: DeletionRef[]): Filter[] {
  const byValue = new Map<string, string>();
  for (const r of refs) if (r.value && !byValue.has(r.value)) byValue.set(r.value, r.author);
  const unique = Array.from(byValue.entries());
  const filters: Filter[] = [];
  for (let i = 0; i < unique.length; i += DELETION_QUERY_CHUNK) {
    const chunk = unique.slice(i, i + DELETION_QUERY_CHUNK);
    // An author deletes each event at most a few times — 2× is a generous
    // bound that still caps a hostile relay.
    const filter: Filter = {
      kinds: [DELETION_KIND],
      authors: Array.from(new Set(chunk.map(([, author]) => author))),
      limit: chunk.length * 2,
    };
    filter[`#${tag}`] = chunk.map(([value]) => value);
    filters.push(filter);
  }
  return filters;
}

/** `#e` refs for `events`. */
export const idRefs = (events: NostrEvent[]): DeletionRef[] =>
  events.map((e) => ({ value: e.id, author: e.pubkey }));

/** `#a` refs for the addressable ones among `events`. */
export const addressRefs = (events: NostrEvent[]): DeletionRef[] =>
  events.flatMap((e) => {
    const value = addressOf(e);
    return value ? [{ value, author: e.pubkey }] : [];
  });

/** Ids of `events` deleted by a kind-5 from the event's own author. */
export function deletedByAuthor(events: NostrEvent[], deletions: NostrEvent[]): Set<string> {
  const byId = new Map<string, NostrEvent>();
  const byAddress = new Map<string, NostrEvent[]>();
  for (const e of events) {
    byId.set(e.id, e);
    const address = addressOf(e);
    if (address) byAddress.set(address, [...(byAddress.get(address) ?? []), e]);
  }
  const deleted = new Set<string>();
  for (const d of deletions) {
    if (d.kind !== DELETION_KIND) continue;
    for (const [name, value] of d.tags) {
      if (!value) continue;
      if (name === 'e') {
        if (byId.get(value)?.pubkey === d.pubkey) deleted.add(value);
      } else if (name === 'a') {
        for (const e of byAddress.get(value) ?? []) {
          if (e.pubkey === d.pubkey && e.created_at <= d.created_at) deleted.add(e.id);
        }
      }
    }
  }
  return deleted;
}
