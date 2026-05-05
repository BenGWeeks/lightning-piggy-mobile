/**
 * Unit tests for the `sendProgress` slice on `WalletContext` (#136).
 *
 * The send-overlay state was previously local to `SendSheet`, leaving
 * the receive flow (which already drives a global overlay through
 * `lastIncomingPayment`) and the send flow asymmetric. These tests
 * exercise the new context actions in isolation — no native module
 * surface is touched, just the in-memory state machine.
 *
 * Heavy service modules (NWC / Nostr / Boltz / on-chain / storage) are
 * stubbed out so the provider mounts cleanly inside a Jest worker
 * without dragging in the real Nostr crypto + WebSocket stack.
 */

// Stub the service modules WalletProvider imports at module-load time.
// Each one is shaped just enough to satisfy a no-op mount: callbacks
// return resolved promises with sane fallbacks, and the storage layer
// claims an empty wallet list so the provider doesn't try to reconnect
// anything during the boot effect.
jest.mock('../services/nwcService', () => ({
  connect: jest.fn().mockResolvedValue({ success: false }),
  disconnect: jest.fn(),
  isWalletConnected: jest.fn().mockReturnValue(false),
  getInfo: jest.fn().mockResolvedValue(null),
  getBalance: jest.fn().mockResolvedValue(null),
  makeInvoice: jest.fn().mockResolvedValue(''),
  payInvoice: jest.fn().mockResolvedValue({ preimage: '' }),
  listTransactions: jest.fn().mockResolvedValue([]),
  lookupInvoice: jest.fn().mockResolvedValue({ paid: false }),
}));

jest.mock('../services/nostrService', () => ({
  DEFAULT_RELAYS: [] as string[],
  getCurrentUserPubkey: jest.fn().mockReturnValue(null),
  getCurrentUserReadRelays: jest.fn().mockReturnValue([]),
  onCurrentUserPubkeyChange: jest.fn().mockReturnValue(() => {}),
  fetchZapReceiptsForRecipient: jest.fn().mockResolvedValue([]),
  fetchZapReceiptsForSender: jest.fn().mockResolvedValue([]),
  fetchProfile: jest.fn().mockResolvedValue(null),
  fetchProfiles: jest.fn().mockResolvedValue(new Map()),
  parseZapReceipt: jest.fn().mockReturnValue(null),
}));

jest.mock('../services/lnurlService', () => ({
  resolveLightningAddress: jest.fn().mockRejectedValue(new Error('not used')),
}));

jest.mock('../services/zapCounterpartyStorage', () => ({
  getMany: jest.fn().mockResolvedValue(new Map()),
  recordOutgoing: jest.fn().mockResolvedValue(undefined),
  getWriteVersion: jest.fn().mockReturnValue(0),
}));

jest.mock('../services/swapRecoveryService', () => ({
  recoverPendingSwaps: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/onchainService', () => ({
  getBalance: jest.fn().mockResolvedValue(null),
  getNextReceiveAddress: jest.fn().mockResolvedValue(''),
  syncAndRefresh: jest.fn().mockResolvedValue({ balance: null, transactions: [] }),
  removeWallet: jest.fn().mockResolvedValue(undefined),
  validateOnchainImport: jest.fn().mockReturnValue(null),
}));

jest.mock('../services/walletStorageService', () => ({
  isOnboarded: jest.fn().mockResolvedValue(true),
  setOnboarded: jest.fn().mockResolvedValue(undefined),
  migrateLegacy: jest.fn().mockResolvedValue(undefined),
  getWalletList: jest.fn().mockResolvedValue([]),
  saveWalletList: jest.fn().mockResolvedValue(undefined),
  generateWalletId: jest.fn().mockReturnValue('test-wallet-id'),
  getNwcUrl: jest.fn().mockResolvedValue(null),
  saveNwcUrl: jest.fn().mockResolvedValue(undefined),
  deleteNwcUrl: jest.fn().mockResolvedValue(undefined),
  getXpub: jest.fn().mockResolvedValue(null),
  saveXpub: jest.fn().mockResolvedValue(undefined),
  deleteXpub: jest.fn().mockResolvedValue(undefined),
  saveMnemonic: jest.fn().mockResolvedValue(undefined),
  deleteMnemonic: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/fiatService', () => ({
  CURRENCIES: ['USD', 'EUR', 'GBP'] as const,
  getBtcPrice: jest.fn().mockResolvedValue(null),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
    multiGet: jest.fn().mockResolvedValue([]),
  },
}));

import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { WalletProvider, useWallet } from './WalletContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <WalletProvider>{children}</WalletProvider>
);

// The provider's boot effect kicks off a few async storage / price
// reads on mount, so each test should let the microtask queue drain
// before asserting — otherwise an unwrapped `setIsLoading(false)`
// fires after `expect`s and trips React's act-warning.
const flushBootEffects = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('WalletContext.sendProgress slice (#136)', () => {
  it('starts with no in-flight send', async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    await flushBootEffects();
    expect(result.current.sendProgress).toBeNull();
  });

  it('reportSendStart populates state with sending + caller-provided fields', async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    await flushBootEffects();
    const onCancel = jest.fn();
    const onDismiss = jest.fn();

    act(() => {
      result.current.reportSendStart({
        amountSats: 1234,
        recipientName: 'Alice',
        onCancel,
        onDismiss,
      });
    });

    expect(result.current.sendProgress).toMatchObject({
      state: 'sending',
      amountSats: 1234,
      recipientName: 'Alice',
      onCancel,
      onDismiss,
    });
    expect(result.current.sendProgress?.at).toEqual(expect.any(Number));
    // No errorMessage on a fresh start.
    expect(result.current.sendProgress?.errorMessage).toBeUndefined();
  });

  it('reportSendSuccess transitions in place and clears the cancel link', async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    await flushBootEffects();
    const onCancel = jest.fn();
    const onDismiss = jest.fn();

    act(() => {
      result.current.reportSendStart({
        amountSats: 50,
        recipientName: 'Bob',
        onCancel,
        onDismiss,
      });
    });
    act(() => {
      result.current.reportSendSuccess();
    });

    expect(result.current.sendProgress?.state).toBe('success');
    // amountSats / recipientName / onDismiss preserved across the transition.
    expect(result.current.sendProgress?.amountSats).toBe(50);
    expect(result.current.sendProgress?.recipientName).toBe('Bob');
    expect(result.current.sendProgress?.onDismiss).toBe(onDismiss);
    // Cancel link is irrelevant once the send has completed — clearing
    // it guards against a stray tap during the success animation
    // re-firing the abort handler against a no-longer-running send.
    expect(result.current.sendProgress?.onCancel).toBeUndefined();
  });

  it('reportSendError stores the message and preserves caller fields', async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    await flushBootEffects();

    act(() => {
      result.current.reportSendStart({ amountSats: 7, recipientName: 'Carol' });
    });
    act(() => {
      result.current.reportSendError('No route');
    });

    expect(result.current.sendProgress).toMatchObject({
      state: 'error',
      errorMessage: 'No route',
      amountSats: 7,
      recipientName: 'Carol',
    });
    expect(result.current.sendProgress?.onCancel).toBeUndefined();
  });

  it('clearSendProgress resets the slot to null', async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    await flushBootEffects();

    act(() => {
      result.current.reportSendStart({ amountSats: 1 });
    });
    expect(result.current.sendProgress).not.toBeNull();

    act(() => {
      result.current.clearSendProgress();
    });
    expect(result.current.sendProgress).toBeNull();
  });

  it('reportSendSuccess / reportSendError are no-ops if no send is in flight', async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    await flushBootEffects();

    act(() => {
      result.current.reportSendSuccess();
    });
    expect(result.current.sendProgress).toBeNull();

    act(() => {
      result.current.reportSendError('boom');
    });
    expect(result.current.sendProgress).toBeNull();
  });

  it('overrides amountSats / recipientName when provided to success or error', async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    await flushBootEffects();

    act(() => {
      result.current.reportSendStart({ amountSats: 100, recipientName: 'Dave' });
    });
    act(() => {
      // E.g. the LNURL callback resolved a different final amount than
      // the amount that was originally entered — let the success report
      // override.
      result.current.reportSendSuccess({ amountSats: 200, recipientName: 'Eve' });
    });

    expect(result.current.sendProgress?.amountSats).toBe(200);
    expect(result.current.sendProgress?.recipientName).toBe('Eve');
  });

  it('each transition advances the `at` timestamp so the overlay re-keys', async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    await flushBootEffects();

    let firstAt = 0;
    act(() => {
      result.current.reportSendStart({ amountSats: 1 });
    });
    firstAt = result.current.sendProgress?.at ?? 0;

    // Spin until Date.now() advances at least one ms so the test isn't
    // flaky on machines fast enough for two `Date.now()` calls within
    // the same millisecond.
    const start = Date.now();
    while (Date.now() === start) {
      // tight loop, max 1 ms
    }

    act(() => {
      result.current.reportSendSuccess();
    });
    const secondAt = result.current.sendProgress?.at ?? 0;

    expect(secondAt).toBeGreaterThan(firstAt);
  });
});
