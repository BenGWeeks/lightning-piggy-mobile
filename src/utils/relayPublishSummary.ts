import type { RelayPublishResult } from '../services/nostrRelayLists';
import { RELAY_LIST_INDEXERS } from './relayListEvents';
const key = (url: string) => {
  try {
    return new URL(url).toString().replace(/\/+$/, '');
  } catch {
    return url.trim().replace(/\/+$/, '');
  }
};

/** Count every target's delivery; keep own failures separate from auxiliary failures. */
export function relayPublishSummary(results: RelayPublishResult[], ownRelays: string[]) {
  const own = new Set(ownRelays.map(key));
  const indexers = new Set(RELAY_LIST_INDEXERS.map(key));
  return {
    sent: results.filter((r) => r.ok).length,
    total: results.length,
    shared: results.filter((r) => r.ok && indexers.has(key(r.url)) && !own.has(key(r.url))).length,
    problems: results.filter((r) => !r.ok && !r.skipped && own.has(key(r.url))),
    skipped: results.filter(
      (r) =>
        r.skipped ||
        (!r.ok && !own.has(key(r.url)) && /connection failure|timed out/i.test(r.message ?? '')),
    ),
  };
}
