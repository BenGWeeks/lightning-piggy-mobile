// A manual "Refresh" of this install's invitation key (#1236). It never
// publishes by itself: it asks the session's single-flight key-package run
// (marmotKeyPackageLifecycle's SingleFlight) to publish regardless of
// freshness, so a refresh can't race automatic maintenance or sign-out.

export interface ClaimedRefresh {
  /** At least one Refresh is waiting: publish even if the current key is fresh. */
  forced: boolean;
  /** Answer every claimed request: true only when a relay accepted the new key. */
  settle(published: boolean): void;
}

export class KeyPackageRefreshRequests {
  private waiting: ((published: boolean) => void)[] = [];

  /**
   * Resolves true once a run publishes a key package a relay accepted; false
   * when that run fails, or after `timeoutMs` (e.g. the run ahead of it is
   * stuck behind a signer prompt nobody answers). Never rejects.
   */
  request(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const answer = (published: boolean) => {
        clearTimeout(timer);
        resolve(published);
      };
      const timer = setTimeout(() => {
        // Not claimed yet: don't force a later, unrelated run.
        this.waiting = this.waiting.filter((w) => w !== answer);
        resolve(false);
      }, timeoutMs);
      this.waiting.push(answer);
    });
  }

  /** Called at the start of a run: takes every request made so far. */
  claim(): ClaimedRefresh {
    const claimed = this.waiting;
    this.waiting = [];
    return {
      forced: claimed.length > 0,
      settle: (published) => claimed.forEach((answer) => answer(published)),
    };
  }
}
