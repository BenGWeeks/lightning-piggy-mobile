/**
 * Concurrency tests for the reverse swap pay + claim orchestration.
 *
 * Boltz's reverse swap invoice is a HOLD invoice: the HTLC is accepted when
 * our payment reaches Boltz (which then locks up on-chain), but the payment
 * only settles after our claim reveals the preimage. `holdInvoiceSwap` models
 * exactly that, so a flow that awaits the payment before claiming would hang
 * here instead of completing.
 */

jest.mock('../services/boltzService', () => ({
  waitForLockup: jest.fn(),
  claimSwap: jest.fn(),
}));
jest.mock('../services/swapRecoveryService', () => ({
  registerPendingSwap: jest.fn(async () => undefined),
  unregisterPendingSwap: jest.fn(async () => undefined),
  recordClaimedFromPreimage: jest.fn(async () => undefined),
  recordReverseSwapLegs: jest.fn(async () => undefined),
  recoverPendingSwaps: jest.fn(async () => undefined),
}));
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
}));

import {
  payAndClaimReverseSwap,
  persistReverseSwap,
  SwapSettlingError,
  type PayAndClaimParams,
  type PersistedReverseSwap,
} from './reverseSwapPayClaim';
import * as boltzService from '../services/boltzService';
import * as swapRecoveryService from '../services/swapRecoveryService';
import * as SecureStore from 'expo-secure-store';

const SWAP = {
  id: 'sw1',
  invoice: 'lnbc30u1p...',
  onchainAmount: 29000,
  timeoutBlockHeight: 900_100,
  lockupAddress: 'bc1plockup',
  refundPublicKey: 'refund-pub',
  swapTree: {
    claimLeaf: { version: 0xc0, output: 'aa' },
    refundLeaf: { version: 0xc0, output: 'bb' },
  },
  preimage: 'preimage-hex',
  claimPrivateKey: 'claim-privkey',
  claimFeeRate: 3,
};
const LOCKUP = { txId: 'lockup-tx', vout: 0, amount: 29000, txHex: 'fixture' };

const waitForLockup = boltzService.waitForLockup as jest.Mock;
const claimSwap = boltzService.claimSwap as jest.Mock;

const named = (name: string, message = name) => Object.assign(new Error(message), { name });
const flush = () => new Promise((r) => setImmediate(r));

// Jest's sandboxed `process` never sees 'unhandledRejection', so instead the
// wallet/lockup promises record whether a rejection handler was attached —
// that is what keeps a later rejection from going unhandled.
const tracked: Tracked<unknown>[] = [];
class Tracked<T> extends Promise<T> {
  static get [Symbol.species]() {
    return Promise;
  }
  rejectionObserved = false;
  constructor(executor: ConstructorParameters<typeof Promise<T>>[0]) {
    super(executor);
    tracked.push(this);
  }
  then<A = T, B = never>(
    onFulfilled?: ((v: T) => A | PromiseLike<A>) | null,
    onRejected?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    if (onRejected) this.rejectionObserved = true;
    return super.then(onFulfilled, onRejected);
  }
}

/** A Boltz reverse swap paid by a wallet that sees a hold invoice. */
function holdInvoiceSwap() {
  const state = {
    paySignal: undefined as AbortSignal | undefined,
    onReplyTimeout: undefined as (() => void) | undefined,
    paymentSettled: false,
    // Boltz lock-up is triggered by our HTLC arriving; tests release it.
    releaseLockup: (() => undefined) as (lockup?: typeof LOCKUP) => void,
    failLockup: (() => undefined) as (e: Error) => void,
    settlePayment: (() => undefined) as (preimage: string) => void,
    failPayment: (() => undefined) as (e: Error) => void,
  };
  let htlcAccepted!: () => void;
  const htlc = new Promise<void>((r) => (htlcAccepted = r));
  const payInvoice = jest.fn(
    (
      _walletId: string,
      _invoice: string,
      opts: { signal: AbortSignal; onReplyTimeout: () => void },
    ) =>
      new Tracked((resolve, reject) => {
        state.paySignal = opts.signal;
        state.onReplyTimeout = opts.onReplyTimeout;
        state.settlePayment = (preimage) => {
          state.paymentSettled = true;
          resolve({ preimage });
        };
        state.failPayment = reject;
        htlcAccepted();
      }),
  );
  waitForLockup.mockImplementation(
    () =>
      new Tracked((resolve, reject) => {
        state.releaseLockup = (lockup = LOCKUP) => void htlc.then(() => resolve(lockup));
        state.failLockup = reject;
      }),
  );
  // Broadcasting the claim reveals the preimage; Boltz then settles the HTLC.
  claimSwap.mockImplementation(async (swap: typeof SWAP) => {
    state.settlePayment(swap.preimage);
    return 'claim-tx';
  });
  return { state, payInvoice };
}

let persisted: PersistedReverseSwap;
const run = (over: Partial<PayAndClaimParams> & Pick<PayAndClaimParams, 'payInvoice'>) =>
  payAndClaimReverseSwap({ persisted, walletId: 'w1', paymentSettleGraceMs: 5, ...over });

beforeEach(async () => {
  jest.clearAllMocks();
  tracked.length = 0;
  persisted = await persistReverseSwap(SWAP, 'bc1qdest');
  jest.clearAllMocks();
});

afterEach(async () => {
  await flush();
  expect(tracked.filter((p) => !p.rejectionObserved)).toEqual([]);
});

describe('persistReverseSwap', () => {
  it('writes the hardened recovery record, then indexes it', async () => {
    await persistReverseSwap(SWAP, 'bc1qdest');
    const [key, raw, opts] = (SecureStore.setItemAsync as jest.Mock).mock.calls[0];
    expect(key).toBe('boltz_swap_sw1');
    expect(JSON.parse(raw)).toEqual({
      id: 'sw1',
      preimage: 'preimage-hex',
      claimPrivateKey: 'claim-privkey',
      lockupAddress: 'bc1plockup',
      destinationAddress: 'bc1qdest',
      refundPublicKey: 'refund-pub',
      swapTree: SWAP.swapTree,
      onchainAmount: 29000,
      timeoutBlockHeight: 900_100,
      claimFeeRate: 3,
    });
    expect(opts).toEqual({ keychainAccessible: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY' });
    expect(
      (swapRecoveryService.registerPendingSwap as jest.Mock).mock.invocationCallOrder[0],
    ).toBeGreaterThan((SecureStore.setItemAsync as jest.Mock).mock.invocationCallOrder[0]);
  });

  it('rejects when the index write fails, so no payable handle exists', async () => {
    (swapRecoveryService.registerPendingSwap as jest.Mock).mockRejectedValueOnce(
      new Error('Invalid pending swap index'),
    );
    await expect(persistReverseSwap(SWAP, 'bc1qdest')).rejects.toThrow(
      'Invalid pending swap index',
    );
  });
});

describe('payAndClaimReverseSwap — hold invoice', () => {
  it('claims on the verified lockup while the payment is held, then the payment settles', async () => {
    const { state, payInvoice } = holdInvoiceSwap();
    const onReplyTimeout = jest.fn();
    const stages: string[] = [];
    const done = run({ payInvoice, onReplyTimeout, onStage: (s) => stages.push(s) });

    await flush();
    // The payment is in flight and held; nothing has revealed the preimage.
    expect(payInvoice).toHaveBeenCalledTimes(1);
    expect(claimSwap).not.toHaveBeenCalled();
    expect(state.paymentSettled).toBe(false);

    state.releaseLockup();
    await expect(done).resolves.toBe('claim-tx');

    expect(claimSwap).toHaveBeenCalledWith(SWAP, LOCKUP, 'bc1qdest');
    expect(state.paymentSettled).toBe(true);
    expect(stages).toEqual(['payAndLockup', 'claimSwap', 'cleanup']);
    // Completed by the live flow — recovery was never needed.
    expect(swapRecoveryService.recoverPendingSwaps).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('boltz_swap_sw1');
    expect(swapRecoveryService.unregisterPendingSwap).toHaveBeenCalledWith('sw1');
    expect(swapRecoveryService.recordClaimedFromPreimage).toHaveBeenCalledWith(
      'preimage-hex',
      'claim-tx',
    );
    expect(swapRecoveryService.recordReverseSwapLegs).toHaveBeenCalledWith(
      'preimage-hex',
      'claim-tx',
      'sw1',
    );
    expect(onReplyTimeout).not.toHaveBeenCalled();
    expect(payInvoice).toHaveBeenCalledTimes(1);
  });

  it('never claims when the lockup fails verification (ambiguous payment → ReplyTimeoutError)', async () => {
    const { state, payInvoice } = holdInvoiceSwap();
    const done = run({ payInvoice });
    await flush();
    state.failLockup(new Error('Reverse lockup does not pay the verified address and amount'));
    await flush();
    // The wallet eventually gives up on the held payment.
    state.failPayment(named('ReplyTimeoutError', 'reply timeout'));
    await expect(done).rejects.toMatchObject({ name: 'ReplyTimeoutError' });
    expect(claimSwap).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('surfaces SwapSettlingError when the payment completed but the lockup failed', async () => {
    const { state, payInvoice } = holdInvoiceSwap();
    const done = run({ payInvoice });
    await flush();
    state.failLockup(new Error('Timeout waiting for swap sw1 after 900s'));
    await flush();
    state.settlePayment('preimage-hex');
    await expect(done).rejects.toBeInstanceOf(SwapSettlingError);
    expect(claimSwap).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('rejected payment before any lockup → "Boltz swap failed", no claim, record kept', async () => {
    const { state, payInvoice } = holdInvoiceSwap();
    const done = run({ payInvoice });
    await flush();
    state.failPayment(new Error('no route'));
    await expect(done).rejects.toThrow('Boltz swap failed: no route');
    expect(claimSwap).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(payInvoice).toHaveBeenCalledTimes(1);
  });

  it('a payment that throws synchronously is still a clean pre-commit failure', async () => {
    waitForLockup.mockReturnValue(new Promise(() => undefined));
    const payInvoice = jest.fn(() => {
      throw new Error('Not connected');
    });
    await expect(run({ payInvoice })).rejects.toThrow('Boltz swap failed: Not connected');
  });

  it('ambiguous payment before lockup rethrows ReplyTimeoutError and gates late callbacks', async () => {
    const { state, payInvoice } = holdInvoiceSwap();
    const onReplyTimeout = jest.fn();
    const done = run({ payInvoice, onReplyTimeout });
    await flush();
    state.onReplyTimeout!();
    expect(onReplyTimeout).toHaveBeenCalledTimes(1);
    state.failPayment(named('ReplyTimeoutError', 'Wallet did not reply in time'));
    await expect(done).rejects.toMatchObject({ name: 'ReplyTimeoutError' });
    // A reply timeout firing after the flow settled must not repaint the caller.
    state.onReplyTimeout!();
    expect(onReplyTimeout).toHaveBeenCalledTimes(1);
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('a lockup that beats a failing payment still claims — lockup evidence wins', async () => {
    const { state, payInvoice } = holdInvoiceSwap();
    claimSwap.mockResolvedValue('claim-tx');
    const done = run({ payInvoice });
    await flush();
    state.releaseLockup();
    await flush();
    state.failPayment(named('ReplyTimeoutError'));
    await expect(done).resolves.toBe('claim-tx');
  });

  it('claim failure → SwapSettlingError, record kept, held payment detached', async () => {
    const { state, payInvoice } = holdInvoiceSwap();
    claimSwap.mockRejectedValue(new Error('Boltz claim broadcast failed after 4 attempts'));
    const done = run({ payInvoice });
    await flush();
    state.releaseLockup();
    await expect(done).rejects.toBeInstanceOf(SwapSettlingError);
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(swapRecoveryService.unregisterPendingSwap).not.toHaveBeenCalled();
    // Our wallet reply polling is stopped; its eventual rejection is observed.
    expect(state.paySignal?.aborted).toBe(true);
    state.failPayment(named('AbortError'));
  });

  it('returns after a bounded grace when the claimed payment is slow to settle', async () => {
    const { state, payInvoice } = holdInvoiceSwap();
    claimSwap.mockResolvedValue('claim-tx'); // Boltz hasn't settled yet
    const done = run({ payInvoice, paymentSettleGraceMs: 20 });
    await flush();
    state.releaseLockup();
    await expect(done).resolves.toBe('claim-tx');
    expect(state.paymentSettled).toBe(false);
    expect(state.paySignal?.aborted).toBe(true);
    state.failPayment(named('ReplyTimeoutError')); // late, and harmless
  });
});

describe('payAndClaimReverseSwap — cancellation', () => {
  it('an already-aborted signal starts neither the payment nor the lockup watch', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const payInvoice = jest.fn();
    await expect(run({ payInvoice, signal: ctrl.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(payInvoice).not.toHaveBeenCalled();
    expect(waitForLockup).not.toHaveBeenCalled();
  });

  it('keeps a dispatched hold invoice in flight on pre-lockup cancellation', async () => {
    const { state, payInvoice } = holdInvoiceSwap();
    const ctrl = new AbortController();
    const done = run({ payInvoice, signal: ctrl.signal });
    await flush();
    ctrl.abort();
    expect(state.paySignal?.aborted).toBe(true);
    state.failPayment(named('AbortError', 'Payment cancelled'));
    await expect(done).rejects.toMatchObject({ name: 'SwapSettlingError' });
    expect(claimSwap).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(payInvoice).toHaveBeenCalledTimes(1);
  });

  it('a cancel after the lockup is verified still claims (committed)', async () => {
    const { state, payInvoice } = holdInvoiceSwap();
    const ctrl = new AbortController();
    claimSwap.mockImplementation(async (swap: typeof SWAP) => {
      ctrl.abort();
      state.settlePayment(swap.preimage);
      return 'claim-tx';
    });
    const done = run({ payInvoice, signal: ctrl.signal });
    await flush();
    state.releaseLockup();
    await expect(done).resolves.toBe('claim-tx');
  });
});
