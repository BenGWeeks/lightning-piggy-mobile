/**
 * Unit tests pinning executeReverseSwap's #891 error contract — the
 * "post-LN-commit must never surface as Payment failed" guarantee.
 *
 * The four catch branches each map to a different caller UX, so a
 * regression here silently reintroduces the #891 false-failure. We mock
 * the swap dependencies and assert the thrown error type per branch.
 */

jest.mock('../services/boltzService', () => ({
  createReverseSwap: jest.fn(),
  waitForLockup: jest.fn(),
  claimSwap: jest.fn(),
}));
jest.mock('../services/swapRecoveryService', () => ({
  registerPendingSwap: jest.fn(async () => undefined),
  unregisterPendingSwap: jest.fn(async () => undefined),
  recordClaimedFromPreimage: jest.fn(async () => undefined),
}));
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
}));
// Match the real helper: it's a name check (see nwcErrors) — keep the test
// independent of @getalby/sdk by stubbing just the predicate we use.
jest.mock('../services/nwcService', () => ({
  isReplyTimeoutError: (e: unknown) => (e as Error)?.name === 'ReplyTimeoutError',
}));

import { executeReverseSwap, isSwapSettlingError, SwapSettlingError } from './reverseSwapSend';
import * as boltzService from '../services/boltzService';
import * as SecureStore from 'expo-secure-store';

const SWAP = {
  id: 'sw1',
  preimage: 'preimage-hex',
  claimPrivateKey: 'claim-privkey',
  lockupAddress: 'bc1plockup',
  refundPublicKey: 'refund-pub',
  swapTree: { foo: 'bar' },
  invoice: 'lnbc30u1p...',
};

const named = (name: string, message = name) => {
  const e = new Error(message);
  e.name = name;
  return e;
};

const params = (over: Partial<Parameters<typeof executeReverseSwap>[0]> = {}) => ({
  walletId: 'w1',
  destinationAddress: 'bc1qdest',
  amountSats: 30000,
  signal: new AbortController().signal,
  payInvoice: jest.fn(async () => ({ preimage: 'preimage-hex' })),
  onReplyTimeout: jest.fn(),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  (boltzService.createReverseSwap as jest.Mock).mockResolvedValue(SWAP);
  (boltzService.waitForLockup as jest.Mock).mockResolvedValue({ lockupTxId: 'tx' });
  (boltzService.claimSwap as jest.Mock).mockResolvedValue('claim-tx-id');
});

describe('executeReverseSwap — #891 error contract', () => {
  it('happy path: resolves and drops the recovery record', async () => {
    await expect(executeReverseSwap(params())).resolves.toBeUndefined();
    // Secrets persisted with hardened keychain accessibility...
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('boltz_swap_sw1', expect.any(String), {
      keychainAccessible: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    });
    // ...then cleaned up on success.
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('boltz_swap_sw1');
  });

  it('rethrows ReplyTimeoutError (ambiguous pay → status unknown) and KEEPS the record', async () => {
    const payInvoice = jest.fn(async () => {
      throw named('ReplyTimeoutError', 'ambiguous');
    });
    await expect(executeReverseSwap(params({ payInvoice }))).rejects.toMatchObject({
      name: 'ReplyTimeoutError',
    });
    // Record left in place so swapRecoveryService can finish it.
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('throws SwapSettlingError when LN committed but the lockup/claim fails', async () => {
    (boltzService.waitForLockup as jest.Mock).mockRejectedValue(new Error('electrum code 1234'));
    let err: unknown;
    try {
      await executeReverseSwap(params());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SwapSettlingError);
    expect(isSwapSettlingError(err)).toBe(true);
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('rethrows AbortError on user cancel', async () => {
    const payInvoice = jest.fn(async () => {
      throw named('AbortError', 'cancelled');
    });
    await expect(executeReverseSwap(params({ payInvoice }))).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('throws "Boltz swap failed" on a genuine pre-commit failure', async () => {
    const payInvoice = jest.fn(async () => {
      throw new Error('insufficient balance');
    });
    await expect(executeReverseSwap(params({ payInvoice }))).rejects.toThrow(
      /Boltz swap failed: insufficient balance/,
    );
  });
});
