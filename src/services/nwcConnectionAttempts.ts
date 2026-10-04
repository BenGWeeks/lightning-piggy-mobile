// Per-wallet NWC handshake tokens, shared by nwcService's connect() and
// reconnect(). A pending handshake must not overwrite a newer provider for the
// same wallet, and a superseded reconnect needs to wait for the newer attempt
// instead of failing outright (#1091 review).

export interface ConnectionAttempt {
  /** Resolves once the attempt has installed its provider or given up. */
  readonly settled: Promise<void>;
  settle: () => void;
  /** Ends the whole attempt. For connect() that is after its initial getBalance
   *  probe, which runs after `settle()` has already released waiters. */
  finish: () => void;
  done: boolean;
}

const connectionAttempts = new Map<string, ConnectionAttempt>();

/** Start a new attempt for `walletId`, superseding any earlier one. */
export function beginConnectionAttempt(walletId: string): ConnectionAttempt {
  let resolve!: () => void;
  const settled = new Promise<void>((r) => {
    resolve = r;
  });
  const attempt: ConnectionAttempt = {
    settled,
    done: false,
    settle: () => resolve(),
    finish: () => {
      attempt.done = true;
      resolve();
    },
  };
  connectionAttempts.set(walletId, attempt);
  return attempt;
}

export function isLatestConnectionAttempt(walletId: string, attempt: ConnectionAttempt): boolean {
  return connectionAttempts.get(walletId) === attempt;
}

/** Forget the wallet's attempt — only `attempt` when given, else any (disconnect). */
export function clearConnectionAttempt(walletId: string, attempt?: ConnectionAttempt): void {
  if (!attempt || connectionAttempts.get(walletId) === attempt) connectionAttempts.delete(walletId);
}

export function hasPendingConnectionAttempt(walletId: string): boolean {
  const attempt = connectionAttempts.get(walletId);
  return !!attempt && !attempt.done;
}

/** Wait until the newest attempt for `walletId` (following any that supersede it) settles. */
export async function waitForNewestConnectionAttempt(walletId: string): Promise<void> {
  let newer = connectionAttempts.get(walletId);
  while (newer) {
    await newer.settled;
    const next = connectionAttempts.get(walletId);
    if (!next || next === newer) return;
    newer = next;
  }
}

// A payment retry that loses its reconnect to a disconnect / URL change can't
// know whether the first request reached the wallet. "connection lost" keeps it
// classified by isConnectionError (unknown outcome), never as "Payment failed".
export const CONNECTION_REPLACED_MESSAGE = 'Connection lost: wallet connection was replaced';
