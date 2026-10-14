import type { NostrNetworkInterface } from '@internet-privacy/marmot-ts';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { matchFilters, type Filter } from 'nostr-tools/filter';
import type { Event } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import { PERF_LOGS_ENABLED } from '../utils/perfLog';
import { createGroupRecovery, type GroupHistoryRequest } from './marmotGroupRecovery';

type Observer = Parameters<ReturnType<NostrNetworkInterface['subscription']>['subscribe']>[0];
type Owner = {
  filters: Filter[];
  observer: Observer;
  recovery?: ReturnType<typeof createGroupRecovery>;
};

/** Merge live routing only; history is recovered independently for each group. */
export function mergedGroupFilters(filters: Filter[]): Filter[] {
  const sets = new Map<string, { filter: Filter; groups: Set<string> }>();
  for (const filter of filters) {
    const { '#h': groups, kinds, ...constraints } = filter;
    delete constraints.since;
    delete constraints.limit;
    const common = { ...constraints, kinds: [...(kinds ?? [])].sort((a, b) => a - b) };
    const key = JSON.stringify(common);
    let set = sets.get(key);
    if (!set) {
      set = { filter: { ...common, since: Math.floor(Date.now() / 1000) - 60 }, groups: new Set() };
      sets.set(key, set);
    }
    for (const h of groups ?? []) set.groups.add(h);
  }
  return [...sets.values()].flatMap(({ filter, groups }) => {
    const chunks: Filter[] = [];
    let chunk: Filter = { ...filter, '#h': [], limit: 0 };
    for (const h of groups) {
      const candidate = { ...chunk, '#h': [...chunk['#h']!, h], limit: 100 };
      if (candidate['#h'].length > 256 || filterBytes(candidate) + FRAMING_BYTES > MAX_REQ_BYTES) {
        if (chunk['#h']!.length) chunks.push(chunk);
        chunk = { ...filter, '#h': [h], limit: 100 };
        if (filterBytes(chunk) + FRAMING_BYTES > MAX_REQ_BYTES)
          throw new RangeError('Marmot group filter exceeds REQ message-size limit');
      } else chunk = candidate;
    }
    if (chunk['#h']!.length) chunks.push(chunk);
    return chunks;
  });
}

const MAX_REQ_BYTES = 64 * 1024;
const FRAMING_BYTES = 256;
/** Re-arm backoff for a relay whose socket keeps failing (DNS, refused, device
 * offline). Doubles per consecutive loss and resets on a successful arm, so an
 * unreachable group relay costs a connect attempt a minute, not one a second. */
export const ROUTE_RETRY_BASE_MS = 1_000;
export const ROUTE_RETRY_MAX_MS = 60_000;
const filterBytes = (filter: Filter) => utf8ToBytes(JSON.stringify(filter)).length + 1;

/** Keep split filters in the same physical REQ when they fit, conserving live slots. */
export function chunkGroupFilters(filters: Filter[]): Filter[][] {
  const chunks: Filter[][] = [];
  let chunk: Filter[] = [];
  let bytes = FRAMING_BYTES;
  for (const filter of filters) {
    const size = filterBytes(filter);
    if (size + FRAMING_BYTES > MAX_REQ_BYTES)
      throw new RangeError('Marmot group filter exceeds REQ message-size limit');
    if (bytes + size > MAX_REQ_BYTES) {
      chunks.push(chunk);
      chunk = [];
      bytes = FRAMING_BYTES;
    }
    chunk.push(filter);
    bytes += size;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

/** One group slot per relay, with exact-filter dispatch and oversized-message rotation. */
export function createGroupSubscriptionMux(
  open: (
    url: string,
    filters: Filter[],
    next: (event: Event) => void,
    onOpen: () => void,
    onClose: () => void,
  ) => { close: () => void },
  request?: GroupHistoryRequest,
  /** A relay's groups caught up after its socket was lost or its REQ paused. */
  onRecovered?: () => void,
) {
  const routes = new Map<
    string,
    {
      owners: Set<Owner>;
      subs: { close: () => void }[];
      timer?: ReturnType<typeof setTimeout>;
      recovering?: boolean;
      lost?: boolean;
      generation: number;
      retryDelay: number;
    }
  >();
  return (urls: string[], filters: Filter[], observer: Observer) => {
    const owner: Owner = { filters, observer };
    const keys = [...new Set(urls.map(normalizeURL))];
    if (request)
      owner.recovery = createGroupRecovery(
        keys,
        filters,
        (event) => observer.next?.(event),
        request,
      );
    // History must also run when the live owner is still queued for a slot.
    void owner.recovery?.recover();
    const update = (url: string) => {
      const route = routes.get(url)!;
      route.generation++;
      if (route.timer) clearTimeout(route.timer);
      if (route.owners.size === 0) {
        // Cancel queued tail chunks before freeing slots held by earlier chunks.
        [...route.subs].reverse().forEach((sub) => sub.close());
        routes.delete(url);
        return;
      }
      // Coalesce connectAll's fan-out into one merged-REQ rebuild this turn.
      route.timer = setTimeout(() => {
        route.timer = undefined;
        // Cancel queued tail chunks before freeing slots held by earlier chunks.
        [...route.subs].reverse().forEach((sub) => sub.close());
        const all = [...route.owners].flatMap((o) => o.filters);
        const merged = mergedGroupFilters(all);
        const chunks = chunkGroupFilters(merged);
        const next = (event: Event) => {
          // Reject ambiguous routing before handing the event to any group.
          if (event.tags.filter((tag) => tag[0] === 'h').length !== 1) return;
          for (const o of route.owners) {
            if (o.recovery) o.recovery.receive(event);
            else if (matchFilters(o.filters, event)) o.observer.next?.(event);
          }
        };
        let index = 0;
        const arm = () => {
          const generation = ++route.generation;
          let opens = 0;
          const onOpen = () => {
            if (generation !== route.generation) return;
            // Transport invokes this on every physical arm, including budget resume.
            chunks[index].forEach((filter) => {
              filter.since = Math.floor(Date.now() / 1000) - 60;
            });
            // A repeat open of this arm is a budget resume; a fresh arm after a
            // lost socket is a reconnect. Either way, catching up means "back".
            const rearm = ++opens > 1 || route.lost === true;
            route.lost = false;
            route.retryDelay = ROUTE_RETRY_BASE_MS;
            if (!route.recovering) {
              route.recovering = true;
              void Promise.all([...route.owners].map((o) => o.recovery?.recover())).finally(() => {
                route.recovering = false;
                if (rearm && routes.get(url) === route) onRecovered?.();
              });
            }
          };
          route.subs = chunks.length
            ? [
                open(url, chunks[index], next, onOpen, () => {
                  // A lost socket retires the budget owner. Recreate it with backoff.
                  if (
                    generation === route.generation &&
                    routes.get(url) === route &&
                    route.owners.size &&
                    !route.timer
                  ) {
                    route.lost = true;
                    const delay = route.retryDelay;
                    route.retryDelay = Math.min(delay * 2, ROUTE_RETRY_MAX_MS);
                    route.timer = setTimeout(() => update(url), delay);
                  }
                }),
              ]
            : [];
          // Extremely large routing sets cannot fit a single wire message.
          // Rotate them on one group slot so even an inbox at limit 4 cannot
          // permanently starve a second REQ. History recovery covers gaps between arms.
          if (chunks.length > 1)
            route.timer = setTimeout(() => {
              route.timer = undefined;
              route.generation++;
              route.subs.forEach((sub) => sub.close());
              index = (index + 1) % chunks.length;
              arm();
            }, 10_000);
        };
        arm();
        if (PERF_LOGS_ENABLED)
          console.log(
            `[Marmot] group subs merged: ${new Set(all.flatMap((f) => f['#h'] ?? [])).size} groups -> ${chunks.length} REQs on ${url}`,
          );
      }, 0);
    };
    for (const key of keys) {
      if (!routes.has(key))
        routes.set(key, {
          owners: new Set(),
          subs: [],
          generation: 0,
          retryDelay: ROUTE_RETRY_BASE_MS,
        });
      routes.get(key)!.owners.add(owner);
      update(key);
    }
    let closed = false;
    return {
      unsubscribe: () => {
        if (closed) return;
        closed = true;
        owner.recovery?.close();
        for (const key of keys) {
          routes.get(key)?.owners.delete(owner);
          if (routes.has(key)) update(key);
        }
      },
    };
  };
}
