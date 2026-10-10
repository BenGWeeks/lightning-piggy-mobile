import type { SetStateAction } from 'react';
import type { DmInboxEntry } from '../utils/conversationSummaries';

/**
 * Account scoping for the in-memory DM inbox.
 *
 * Several accounts can share one phone (Lightning Piggy is a family app), so
 * one account's conversations must never render under another. The inbox
 * state is therefore tagged with the pubkey that owns it, and every write
 * names the owner it was computed for:
 *
 *  - A write from an owner that is no longer active (an in-flight refresh,
 *    a live-sub or Marmot teardown flush that lands after an account switch)
 *    is dropped.
 *  - A write from the active owner never builds on another owner's entries
 *    (the base is reset to empty when ownership changes hands).
 *  - The read side only exposes entries owned by the active pubkey, so the
 *    first render after a switch is already scoped, even before any write.
 */
export interface ScopedDmInbox {
  owner: string | null;
  entries: DmInboxEntry[];
}

/** Stable empty list so a scoped-out read doesn't change identity per render. */
export const EMPTY_DM_INBOX: DmInboxEntry[] = [];

export const INITIAL_SCOPED_DM_INBOX: ScopedDmInbox = { owner: null, entries: EMPTY_DM_INBOX };

/** The entries visible to `activeOwner`: its own, or none. */
export function selectScopedDmInbox(
  state: ScopedDmInbox,
  activeOwner: string | null,
): DmInboxEntry[] {
  return state.owner === activeOwner ? state.entries : EMPTY_DM_INBOX;
}

/**
 * Apply one inbox write on behalf of `writer`. `activeOwner` is the account
 * that is active when React applies the write; a write from any other account
 * is stale and leaves the state untouched.
 */
export function applyScopedDmInboxUpdate(
  prev: ScopedDmInbox,
  writer: string | null,
  activeOwner: string | null,
  action: SetStateAction<DmInboxEntry[]>,
): ScopedDmInbox {
  if (writer !== activeOwner) return prev;
  const base = prev.owner === writer ? prev.entries : EMPTY_DM_INBOX;
  const next = typeof action === 'function' ? action(base) : action;
  if (prev.owner === writer && next === prev.entries) return prev;
  return { owner: writer, entries: next };
}

/**
 * An AbortSignal that fires when either input does. `dispose` detaches the
 * listeners — the account signal outlives many refreshes, so each refresh
 * must release its hook on it when done.
 */
export function linkAbortSignals(
  primary: AbortSignal | undefined,
  account: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  if (!primary) return { signal: account, dispose: () => {} };
  const ctrl = new AbortController();
  const abort = (): void => ctrl.abort();
  if (primary.aborted || account.aborted) {
    ctrl.abort();
    return { signal: ctrl.signal, dispose: () => {} };
  }
  primary.addEventListener('abort', abort, { once: true });
  account.addEventListener('abort', abort, { once: true });
  return {
    signal: ctrl.signal,
    dispose: () => {
      primary.removeEventListener('abort', abort);
      account.removeEventListener('abort', abort);
    },
  };
}
