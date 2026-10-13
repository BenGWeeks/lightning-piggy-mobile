import type { AbstractSimplePool, SubCloser } from 'nostr-tools/abstract-pool';
import { normalizeURL } from 'nostr-tools/utils';
import type { AbstractRelay } from 'nostr-tools/abstract-relay';
import { RelayOperationDrain } from './relayOperationDrain';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS mixin constructor signature
type PoolClass = abstract new (...args: any[]) => AbstractSimplePool;

/** Replace stale transports without losing other features sharing their sockets. */
export function withResumableSubscriptions<TBase extends PoolClass>(Base: TBase) {
  abstract class ResumablePool extends Base {
    private resetsInFlight = 0;
    private readonly operationDrains = new WeakMap<AbstractRelay, RelayOperationDrain>();
    private readonly retiredRelays = new Set<AbstractRelay>();
    private readonly publishes = new Map<string, Set<Promise<string>>>();

    ensureRelay(...args: Parameters<AbstractSimplePool['ensureRelay']>): Promise<AbstractRelay> {
      const result = super.ensureRelay(...args);
      // ensureRelay creates the relay synchronously, before awaiting connect().
      // Instrument before the socket can receive an automatic AUTH challenge.
      let url: string;
      try {
        url = normalizeURL(args[0]);
      } catch {
        return result;
      }
      const relay = this.relays.get(url);
      if (relay && !this.operationDrains.has(relay)) {
        this.operationDrains.set(relay, new RelayOperationDrain(relay));
        const onclose = relay.onclose;
        relay.onclose = () => {
          this.retiredRelays.delete(relay);
          // Closing a drained socket must not evict its live replacement.
          if (this.relays.get(url) === relay) onclose?.();
        };
      }
      return result;
    }

    publish(...args: Parameters<AbstractSimplePool['publish']>): Promise<string>[] {
      const results = super.publish(...args);
      results.forEach((result, i) => {
        const url = normalizeURL(args[0][i]);
        const pending = this.publishes.get(url) ?? new Set<Promise<string>>();
        this.publishes.set(url, pending);
        pending.add(result);
        const finish = () => {
          pending.delete(result);
          if (pending.size === 0) this.publishes.delete(url);
        };
        void result.then(finish, finish);
      });
      return results;
    }

    close(urls: string[]): void {
      super.close(urls);
      const targets = new Set(urls.map(normalizeURL));
      for (const relay of this.retiredRelays) {
        if (targets.has(relay.url)) relay.close();
      }
    }

    destroy(): void {
      super.destroy();
      // COUNT has no SDK timeout; explicit pool teardown still releases it.
      for (const relay of this.retiredRelays) relay.close();
      this.retiredRelays.clear();
    }

    private readonly pendingOpens = new Set<() => void>();
    private readonly subscriptions = new Set<{
      urls: string[];
      pause(): Promise<void>;
      open(): void;
    }>();

    subscribeMap(
      requests: Parameters<AbstractSimplePool['subscribeMap']>[0],
      params: Parameters<AbstractSimplePool['subscribeMap']>[1],
    ): SubCloser {
      let generation = 0;
      let stopped = false;
      let sub: SubCloser | undefined;
      const entry = {
        urls: requests.map(({ url }) => normalizeURL(url)),
        pause: async () => {
          generation++;
          await sub?.close();
        },
        open: () => {
          if (stopped) return;
          if (this.resetsInFlight > 0) {
            this.pendingOpens.add(entry.open);
            return;
          }
          const currentGeneration = ++generation;
          const current = () => generation === currentGeneration;
          sub = super.subscribeMap(requests, {
            ...params,
            onevent: (event) => {
              if (current()) params.onevent?.(event);
            },
            oneose: () => {
              if (current()) params.oneose?.();
            },
            onclose: (reasons) => {
              if (!current()) return;
              stopped = true;
              this.subscriptions.delete(entry);
              params.onclose?.(reasons);
            },
          });
        },
      };
      this.subscriptions.add(entry);
      entry.open();
      return {
        close: (reason) => {
          stopped = true;
          this.subscriptions.delete(entry);
          this.pendingOpens.delete(entry.open);
          return sub?.close(reason) ?? Promise.resolve();
        },
      };
    }

    async resetTransports(relays: string[]): Promise<void> {
      const targets = new Set(relays.map(normalizeURL));
      const affected = [...this.subscriptions].filter((entry) =>
        entry.urls.some((url) => targets.has(url)),
      );
      this.resetsInFlight++;
      // Wait for in-flight subscription opens before replacing sockets. Keep
      // caller close handles stable, and suppress intentional close callbacks.
      try {
        await Promise.all(affected.map((entry) => entry.pause()));
        for (const url of targets) {
          const relay = this.relays.get(url);
          const drain = relay && this.operationDrains.get(relay);
          if (!relay || !drain) {
            super.close([url]);
            continue;
          }
          // New reads use a fresh transport immediately. Keep the old one for
          // EVENT/AUTH/COUNT responses, including pool-level AUTH retry chains.
          for (const result of this.publishes.get(url) ?? []) drain.track(result);
          this.relays.delete(url);
          this.retiredRelays.add(relay);
          drain.retire();
        }
      } finally {
        // New subscriptions must not open on sockets about to be replaced.
        // Drain only after every concurrent reset has finished closing them.
        affected.forEach((entry) => entry.open());
        if (--this.resetsInFlight === 0) {
          const pending = [...this.pendingOpens];
          this.pendingOpens.clear();
          pending.forEach((open) => open());
        }
      }
    }
  }
  return ResumablePool;
}
