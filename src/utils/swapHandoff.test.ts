/**
 * TransferSheet's post-handoff decisions: which reverse-swap failures prove
 * no sats left (so the "in progress" placeholders can go), and the completion
 * copy that replaces "swap underway". The classifier is exercised against the
 * errors the real payAndClaimReverseSwap throws, not hand-built ones.
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
}));
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
}));

import {
  isReverseSwapNotPaid,
  reverseSwapCompleteMessage,
  submarineSwapCompleteMessage,
} from './swapHandoff';
import { payAndClaimReverseSwap, persistReverseSwap } from './reverseSwapPayClaim';
import { createReplyTimeoutError } from '../services/nwcErrors';
import * as boltzService from '../services/boltzService';
import type { ReverseSwapResult } from '../services/boltzService';

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
} as ReverseSwapResult;
const LOCKUP = { txId: 'lockup-tx', vout: 0, amount: 29000, txHex: 'fixture' };

const waitForLockup = boltzService.waitForLockup as jest.Mock;
const claimSwap = boltzService.claimSwap as jest.Mock;

// No lockup ever appears; the watch ends when the flow aborts it.
const lockupNever = (_swap: unknown, _ms: number, signal: AbortSignal) =>
  new Promise((_resolve, reject) =>
    signal.addEventListener('abort', () => reject(new Error('aborted'))),
  );

async function failureOf(payInvoice: jest.Mock): Promise<unknown> {
  const persisted = await persistReverseSwap(SWAP, 'bc1qdest');
  return payAndClaimReverseSwap({
    persisted,
    walletId: 'w1',
    payInvoice,
    paymentSettleGraceMs: 0,
  }).then(
    () => {
      throw new Error('expected the swap to fail');
    },
    (e: unknown) => e,
  );
}

describe('isReverseSwapNotPaid', () => {
  beforeEach(() => {
    waitForLockup.mockReset();
    claimSwap.mockReset();
  });

  it('is true when the wallet definitively rejected the payment', async () => {
    waitForLockup.mockImplementation(lockupNever);
    const e = await failureOf(jest.fn(async () => Promise.reject(new Error('no route found'))));
    expect((e as Error).message).toBe('Boltz swap failed: no route found');
    expect(isReverseSwapNotPaid(e)).toBe(true);
  });

  it('is false when the wallet reply timed out (payment may have settled)', async () => {
    waitForLockup.mockImplementation(lockupNever);
    const e = await failureOf(jest.fn(async () => Promise.reject(createReplyTimeoutError())));
    expect(isReverseSwapNotPaid(e)).toBe(false);
  });

  it('is false for a relay connection error (payment outcome unknown, #648)', async () => {
    waitForLockup.mockImplementation(lockupNever);
    const e = await failureOf(
      jest.fn(async () => Promise.reject(new Error('Failed to connect to wss://relay.example'))),
    );
    expect((e as Error).message).toMatch(/^Boltz swap failed: /);
    expect(isReverseSwapNotPaid(e)).toBe(false);
  });

  it('is false once Boltz locked up (committed) even if the claim fails', async () => {
    waitForLockup.mockResolvedValue(LOCKUP);
    claimSwap.mockRejectedValue(new Error('broadcast rejected'));
    // Hold invoice: the payment stays in flight while the claim runs.
    const e = await failureOf(jest.fn(() => new Promise(() => undefined)));
    expect((e as Error).name).toBe('SwapSettlingError');
    expect(isReverseSwapNotPaid(e)).toBe(false);
  });

  it('is false for non-Error values', () => {
    expect(isReverseSwapNotPaid('Boltz swap failed: x')).toBe(false);
    expect(isReverseSwapNotPaid(undefined)).toBe(false);
  });
});

describe('swap completion copy', () => {
  it('reverse: states the Boltz-locked amount less the claim fee, not the invoice amount', () => {
    // User moved 30,000 sats over Lightning; Boltz locked 29,000 on-chain.
    const msg = reverseSwapCompleteMessage(29000, 'abcdef0123456789');
    expect(msg).toContain('Swap complete');
    expect(msg).toContain((29000).toLocaleString());
    expect(msg).toContain('less the on-chain claim fee');
    expect(msg).toContain('abcdef0123…');
    expect(msg).not.toContain((30000).toLocaleString());
    expect(msg).not.toMatch(/underway|being sent/i);
  });

  it('submarine: states the Lightning invoice amount delivered', () => {
    expect(submarineSwapCompleteMessage(30000)).toBe(
      `Swap complete — ${(30000).toLocaleString()} sats delivered via Lightning.`,
    );
  });
});
