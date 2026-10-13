import type { AbstractRelay } from 'nostr-tools/abstract-relay';

/** Keep a replaced socket alive until its response-bearing operations settle. */
export class RelayOperationDrain {
  private readonly pending = new Set<Promise<unknown>>();
  private retired = false;

  constructor(private readonly relay: AbstractRelay) {
    // AUTH includes asynchronous signing, before the SDK registers its OK waiter.
    relay.publish = this.wrap(relay.publish.bind(relay));
    relay.auth = this.wrap(relay.auth.bind(relay));
    relay.count = this.wrap(relay.count.bind(relay));
  }

  private wrap<Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) {
    return (...args: Args): Promise<Result> => {
      const result = operation(...args);
      this.track(result);
      return result;
    };
  }

  track(result: Promise<unknown>): void {
    this.pending.add(result);
    const finish = () => {
      this.pending.delete(result);
      this.closeIfDrained();
    };
    void result.then(finish, finish);
  }

  retire(): void {
    this.retired = true;
    this.closeIfDrained();
  }

  private closeIfDrained(): void {
    if (this.retired && this.pending.size === 0) this.relay.close();
  }
}
