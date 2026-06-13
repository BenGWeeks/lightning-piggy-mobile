import type { NostrContact } from '../types/nostr';
import { normalizePubkey } from './pubkey';

/**
 * Parse the `p` tags of a kind-3 (contact list) event into contacts.
 * Drops malformed `p` values (zero-prefixed junk, wrong length, non-hex)
 * and lowercases the rest at the ingest boundary, then de-duplicates — so
 * junk pubkeys never reach the Friends list, the WoT set, or the cache
 * (#855). The ingest twin of `sanitizeContacts` (which heals the cache on
 * read).
 */
export function tagsToContacts(tags: string[][]): NostrContact[] {
  const seen = new Set<string>();
  const contacts: NostrContact[] = [];
  for (const tag of tags) {
    if (tag[0] !== 'p') continue;
    const pubkey = normalizePubkey(tag[1]);
    if (!pubkey || seen.has(pubkey)) continue;
    seen.add(pubkey);
    contacts.push({ pubkey, relay: tag[2] || null, petname: tag[3] || null, profile: null });
  }
  return contacts;
}

/**
 * Drop contacts whose pubkey isn't a canonical 64-hex value, lowercasing
 * those that pass, and de-duplicate. Applied when reading the cached
 * contact list so junk persisted before the ingest-time fix (#855) — most
 * visibly zero-prefixed all-junk strings like `000000001c5c…` — disappears
 * from the Friends list on the next load rather than lingering forever in
 * AsyncStorage.
 */
export function sanitizeContacts(contacts: unknown): NostrContact[] {
  // A corrupt AsyncStorage blob can JSON.parse to a non-array (or null);
  // treat anything that isn't an array as "no contacts" rather than
  // throwing and aborting hydration.
  if (!Array.isArray(contacts)) return [];
  const seen = new Set<string>();
  const out: NostrContact[] = [];
  for (const c of contacts) {
    const pubkey = normalizePubkey(c?.pubkey);
    if (!pubkey || seen.has(pubkey)) continue;
    seen.add(pubkey);
    out.push(pubkey === c.pubkey ? c : { ...c, pubkey });
  }
  return out;
}
