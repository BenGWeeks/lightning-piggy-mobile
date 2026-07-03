// Abort-and-replace single-flight controller (#868). Holds at most one live
// AbortController. Each `begin()` aborts the previous one and installs a fresh
// controller, returning its signal — so a re-entrant caller (the conversation
// screen's mount effect re-firing, a live-sub re-fetch, or a second
// pull-to-refresh) supersedes the in-flight run instead of stacking a second
// concurrent decrypt loop. `abort()` cancels the current run (unmount cleanup).
//
// This is the conversation-path analogue of refreshDmInbox's single-flight: the
// inbox coalesces onto one in-flight promise; the thread, which must always
// reflect the LATEST open, replaces rather than coalesces.
export interface AbortReplacer {
  /** Abort the previous run (if any) and start a new one. Returns its signal. */
  begin: () => AbortSignal;
  /** Abort the current run without starting a new one (e.g. on unmount). */
  abort: () => void;
  /** The current signal, or null if nothing is in flight. */
  readonly current: AbortSignal | null;
}

export function createAbortReplacer(): AbortReplacer {
  let controller: AbortController | null = null;
  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      return controller.signal;
    },
    abort() {
      controller?.abort();
      controller = null;
    },
    get current() {
      return controller?.signal ?? null;
    },
  };
}
