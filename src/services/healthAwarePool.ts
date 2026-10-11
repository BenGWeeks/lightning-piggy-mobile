import type { AbstractSimplePool } from 'nostr-tools/abstract-pool';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import {
  RELAY_CONNECT_TIMEOUT_MS,
  RELAY_SKIPPED_REASON,
  noteNetworkActivity,
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
 *   outcome feeds `./relayHealth`, once per physical attempt. Only NEW
 *   connections count as a relay success; a reused open socket proves nothing.
 *   Events and publish OKs on open sockets corroborate that the network works.
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
    /** One recorded outcome per physical connection attempt, by relay. */
    private readonly connectAttempts = new Map<string, Promise<void>>();

    ensureRelay(
      url: string,
      params?: { connectionTimeout?: number; abort?: AbortSignal },
    ): ReturnType<AbstractSimplePool['ensureRelay']> {
      let key = url;
      let wasConnected = false;
      try {
        key = normalizeURL(url);
        wasConnected = this.relays.get(key)?.connected === true;
      } catch {
        // Unparseable URL: super.ensureRelay rejects below and we record it.
      }
      const connectionTimeout = Math.min(
        params?.connectionTimeout ?? RELAY_CONNECT_TIMEOUT_MS,
        RELAY_CONNECT_TIMEOUT_MS,
      );
      const relay = super.ensureRelay(url, { ...params, connectionTimeout });
      // A reused open socket proves nothing either way. Concurrent callers
      // share nostr-tools' single connection promise, so only the caller that
      // started the attempt records its outcome, and an abort by that caller
      // (which rejects every waiter) records nothing.
      if (wasConnected || this.connectAttempts.has(key)) return relay;
      const outcome = relay.then(
        () => recordRelaySuccess(url),
        () => {
          if (!params?.abort?.aborted) recordRelayFailure(url);
        },
      );
      this.connectAttempts.set(key, outcome);
      void outcome.finally(() => this.connectAttempts.delete(key));
      return relay;
    }

    subscribeMap(
      requests: Parameters<AbstractSimplePool['subscribeMap']>[0],
      params: Parameters<AbstractSimplePool['subscribeMap']>[1],
    ): ReturnType<AbstractSimplePool['subscribeMap']> {
      const keep = new Set(selectHealthyRelays(requests.map((r) => r.url)));
      const healthy = requests.filter((r) => keep.has(r.url));
      const { onevent } = params;
      return super.subscribeMap(healthy.length === requests.length ? requests : healthy, {
        ...params,
        // Events arriving prove the network works (corroborates failures).
        onevent: (event) => {
          noteNetworkActivity();
          onevent?.(event);
        },
      });
    }

    publish(
      relays: string[],
      event: NostrEvent,
      params?: Parameters<AbstractSimplePool['publish']>[2],
    ): Promise<string>[] {
      const keep = new Set(selectHealthyRelays(relays));
      const kept = relays.filter((r) => keep.has(r));
      const results = super.publish(kept, event, params).map((p) => {
        // An OK from a relay proves the network works (corroborates failures).
        // nostr-tools RESOLVES a failed connect with "connection failure: …".
        p.then(
          (reason) => {
            if (!String(reason).startsWith('connection failure')) noteNetworkActivity();
          },
          () => {},
        );
        return p;
      });
      if (kept.length === relays.length) return results;
      let next = 0;
      return relays.map((r) =>
        keep.has(r) ? results[next++] : Promise.reject(new Error(RELAY_SKIPPED_REASON)),
      );
    }
  }
  return HealthAware;
}
