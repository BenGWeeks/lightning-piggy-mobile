import type { AbstractSimplePool, SubCloser } from 'nostr-tools/abstract-pool';
import { normalizeURL } from 'nostr-tools/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS mixin constructor signature
type PoolClass = abstract new (...args: any[]) => AbstractSimplePool;

/** Replace stale transports without losing other features sharing their sockets. */
export function withResumableSubscriptions<TBase extends PoolClass>(Base: TBase) {
  abstract class ResumablePool extends Base {
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
      let sub: SubCloser;
      const entry = {
        urls: requests.map(({ url }) => normalizeURL(url)),
        pause: async () => {
          generation++;
          await sub.close();
        },
        open: () => {
          if (stopped) return;
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
          return sub.close(reason);
        },
      };
    }

    async resetTransports(relays: string[]): Promise<void> {
      const targets = new Set(relays.map(normalizeURL));
      const affected = [...this.subscriptions].filter((entry) =>
        entry.urls.some((url) => targets.has(url)),
      );
      // Wait for in-flight subscription opens before replacing sockets. Keep
      // caller close handles stable, and suppress intentional close callbacks.
      await Promise.all(affected.map((entry) => entry.pause()));
      super.close(relays);
      affected.forEach((entry) => entry.open());
    }
  }
  return ResumablePool;
}
