import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export type PaymentCompletionSource = 'reply' | 'notification' | 'lookup' | 'verify';
export interface PaymentCandidate {
  preimage?: string | null;
  paid?: boolean;
  state?: string;
  settled_at?: number;
  settled?: boolean;
}

export function matchesPaymentHash(preimage: unknown, paymentHash: string): preimage is string {
  return (
    typeof preimage === 'string' &&
    /^[a-f0-9]{64}$/i.test(preimage) &&
    bytesToHex(sha256(hexToBytes(preimage))) === paymentHash.toLowerCase()
  );
}

export function isSettledPayment(result: PaymentCandidate | null | undefined): boolean {
  return (
    !!result &&
    (result.paid === true ||
      (typeof result.state === 'string' && result.state.toLowerCase() === 'settled') ||
      (typeof result.settled_at === 'number' && result.settled_at > 0))
  );
}

interface CompletionOptions {
  paymentHash: string;
  reply: (signal: AbortSignal) => Promise<PaymentCandidate>;
  lookup: (signal: AbortSignal) => Promise<PaymentCandidate | null>;
  verify?: (signal: AbortSignal) => Promise<PaymentCandidate | null>;
  subscribe?: (
    accept: (candidate: PaymentCandidate) => void,
    signal: AbortSignal,
  ) => Promise<() => void>;
  signal?: AbortSignal;
  budgetMs?: number;
  timeoutError: () => Error;
  /** Throw for terminal failures; return for a reply timeout with unknown outcome. */
  onReplyError: (error: unknown) => void;
}

/** Dependency-injected completion race. Only settled, hash-verified proofs win.
 * SDK requests may not be cancellable; abort stops polling and discards late replies. */
export function completePayment(options: CompletionOptions): Promise<{
  preimage: string;
  source: PaymentCompletionSource;
  elapsedMs: number;
}> {
  const started = Date.now();
  const controller = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let unsubscribe: (() => void) | undefined;
  let finished = false;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      finished = true;
      controller.abort();
      timers.forEach(clearTimeout);
      timers.clear();
      unsubscribe?.();
      options.signal?.removeEventListener('abort', cancel);
    };
    const fail = (error: unknown) => {
      if (finished) return;
      cleanup();
      reject(error);
    };
    const cancel = () =>
      fail(Object.assign(new Error('Payment cancelled'), { name: 'AbortError' }));
    const accept = (source: PaymentCompletionSource, candidate: PaymentCandidate | null) => {
      if (finished || !candidate) return;
      const settled =
        source === 'reply' ||
        source === 'notification' ||
        (source === 'verify' ? candidate.settled === true : isSettledPayment(candidate));
      if (!settled || !matchesPaymentHash(candidate.preimage, options.paymentHash)) return;
      cleanup();
      resolve({ preimage: candidate.preimage, source, elapsedMs: Date.now() - started });
    };
    const schedule = (fn: () => void, ms: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.add(timer);
    };
    const poll = (
      source: 'lookup' | 'verify',
      request: (signal: AbortSignal) => Promise<PaymentCandidate | null>,
      index = 0,
    ) => {
      schedule(
        () => {
          if (finished) return;
          void Promise.resolve()
            .then(() => request(controller.signal))
            .then(
              (candidate) => accept(source, candidate),
              () => undefined,
            )
            .finally(() => {
              if (!finished) poll(source, request, index + 1);
            });
        },
        [3000, 5000, 8000][index] ?? 10000,
      );
    };
    if (options.signal?.aborted) {
      cancel();
      return;
    }
    options.signal?.addEventListener('abort', cancel, { once: true });
    schedule(() => fail(options.timeoutError()), options.budgetMs ?? 90000);
    if (options.subscribe) {
      void options
        .subscribe((candidate) => accept('notification', candidate), controller.signal)
        .then(
          (close) => {
            if (finished) close();
            else unsubscribe = close;
          },
          () => undefined,
        );
    }
    if (finished) return;
    poll('lookup', options.lookup);
    if (options.verify) poll('verify', options.verify);
    void options.reply(controller.signal).then(
      (candidate) => accept('reply', candidate),
      (error) => {
        if (finished) return;
        try {
          options.onReplyError(error);
        } catch (terminal) {
          fail(terminal);
        }
      },
    );
  });
}
