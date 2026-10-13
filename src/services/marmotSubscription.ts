// The shared SimplePool does not auto-reconnect. Own each relay's live
// subscription so a partial drop cannot leave a group permanently deaf.
import { AppState } from 'react-native';
import type { Event, Filter } from 'nostr-tools';
import { pool } from './nostrPool';

const RESUME_DELAY_MS = 3_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;
const MAX_SEEN_EVENTS = 2_000;

export function subscribeMarmotRelays(
  relays: string[],
  filters: Filter[],
  onEvent: (event: Event) => void,
): { unsubscribe(): void } {
  let stopped = false;
  let foreground = AppState.currentState !== 'background';
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  const seen = new Set<string>();
  const routes = relays.flatMap((relay) =>
    filters.map((filter) => ({
      relay,
      filter,
      generation: 0,
      attempt: 0,
      close: null as (() => void) | null,
      timer: null as ReturnType<typeof setTimeout> | null,
    })),
  );
  type Route = (typeof routes)[number];
  const clearRetry = (route: Route) => {
    if (route.timer !== null) clearTimeout(route.timer);
    route.timer = null;
  };
  const open = (route: Route) => {
    if (stopped) return;
    clearRetry(route);
    const generation = ++route.generation;
    route.close?.(); // any synchronous close callback is now stale
    const current = () => !stopped && generation === route.generation;
    const sub = pool.subscribeMany([route.relay], route.filter, {
      onevent: (event) => {
        if (!current()) return;
        route.attempt = 0;
        // subscribeMany previously deduped the relay fan-out. Preserve that
        // boundary now that each relay has its own reconnect lifecycle.
        if (seen.has(event.id)) return;
        seen.add(event.id);
        if (seen.size > MAX_SEEN_EVENTS) seen.delete(seen.values().next().value!);
        onEvent(event);
      },
      onclose: () => {
        if (!current() || !foreground || route.timer !== null) return;
        const delay = Math.min(RETRY_BASE_MS * 2 ** route.attempt++, RETRY_MAX_MS);
        route.timer = setTimeout(() => {
          route.timer = null;
          open(route);
        }, delay);
      },
    });
    route.close = () => void sub.close();
  };
  const clearResume = () => {
    if (resumeTimer !== null) clearTimeout(resumeTimer);
    resumeTimer = null;
  };
  const stateSub = AppState.addEventListener('change', (state) => {
    clearResume();
    foreground = state === 'active';
    routes.forEach(clearRetry);
    if (!foreground || stopped) return;
    // Group MLS ingest is non-urgent work: DM wraps re-arm immediately,
    // group subscriptions follow the app's three-second resume stagger.
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      if (stopped || !foreground) return;
      if (__DEV__) console.log('[Marmot] resume — re-arming relay subscriptions');
      routes.forEach((route) => {
        route.attempt = 0;
        open(route);
      });
    }, RESUME_DELAY_MS);
  });
  routes.forEach(open);
  return {
    unsubscribe: () => {
      if (stopped) return;
      stopped = true;
      clearResume();
      stateSub.remove();
      routes.forEach((route) => {
        route.generation++;
        clearRetry(route);
        route.close?.();
      });
    },
  };
}
