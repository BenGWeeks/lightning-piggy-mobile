import type { AbstractSimplePool } from 'nostr-tools/abstract-pool';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import {
  RELAY_CONNECT_TIMEOUT_MS,
  RELAY_SKIPPED_REASON,
  recordRelayFailure,
  recordRelaySuccess,
  selectHealthyRelays,
} from './relayHealth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS mixin constructor signature
type PoolClass = abstract new (...args: any[]) => AbstractSimplePool;

/**
 * Makes a nostr-tools pool class stop waiting on relays known to be dead
 * (#1326). Applied to the shared pool (`./nostrPool`) and the market
 * snapshot's pool (`./marketListingsPool`).
 *
 * - Every connection attempt is capped at `RELAY_CONNECT_TIMEOUT_MS` and its
 *   outcome feeds `./relayHealth`. Only NEW connections count as a success; a
 *   reused open socket proves nothing about the network right now.
 * - Subscriptions (and so `querySync` / `get` / `subscribeMany`) leave out
 *   parked relays, so aggregate EOSE no longer waits on them.
 * - Publishes skip parked relays too. The returned array still lines up with
 *   the `relays` argument: a skipped relay's promise rejects with
 *   `RELAY_SKIPPED_REASON`, so per-relay result reporting keeps working.
 *
 * `selectHealthyRelays` always keeps the healthiest 2 relays of a request,
 * so nothing is ever sent nowhere. Callers that connect relay by relay via
 * `ensureRelay` should pick their URLs with `selectHealthyRelays` themselves.
 */
export function withRelayHealth<TBase extends PoolClass>(Base: TBase) {
  abstract class HealthAware extends Base {
    async ensureRelay(
      url: string,
      params?: { connectionTimeout?: number; abort?: AbortSignal },
    ): ReturnType<AbstractSimplePool['ensureRelay']> {
      let wasConnected = false;
      try {
        wasConnected = this.relays.get(normalizeURL(url))?.connected === true;
      } catch {
        // Unparseable URL: super.ensureRelay throws below and we record it.
      }
      const connectionTimeout = Math.min(
        params?.connectionTimeout ?? RELAY_CONNECT_TIMEOUT_MS,
        RELAY_CONNECT_TIMEOUT_MS,
      );
      try {
        const relay = await super.ensureRelay(url, { ...params, connectionTimeout });
        if (!wasConnected) recordRelaySuccess(url);
        return relay;
      } catch (err) {
        if (!params?.abort?.aborted) recordRelayFailure(url);
        throw err;
      }
    }

    subscribeMap(
      requests: Parameters<AbstractSimplePool['subscribeMap']>[0],
      params: Parameters<AbstractSimplePool['subscribeMap']>[1],
    ): ReturnType<AbstractSimplePool['subscribeMap']> {
      const keep = new Set(selectHealthyRelays(requests.map((r) => r.url)));
      const healthy = requests.filter((r) => keep.has(r.url));
      return super.subscribeMap(healthy.length === requests.length ? requests : healthy, params);
    }

    publish(
      relays: string[],
      event: NostrEvent,
      params?: Parameters<AbstractSimplePool['publish']>[2],
    ): Promise<string>[] {
      const keep = new Set(selectHealthyRelays(relays));
      const kept = relays.filter((r) => keep.has(r));
      if (kept.length === relays.length) return super.publish(relays, event, params);
      const results = super.publish(kept, event, params);
      let next = 0;
      return relays.map((r) =>
        keep.has(r) ? results[next++] : Promise.reject(new Error(RELAY_SKIPPED_REASON)),
      );
    }
  }
  return HealthAware;
}
