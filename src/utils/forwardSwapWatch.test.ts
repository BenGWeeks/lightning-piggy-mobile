const mockToastShow = jest.fn();
jest.mock('../components/BrandedToast', () => ({
  __esModule: true,
  default: { show: (...args: unknown[]) => mockToastShow(...args) },
}));
jest.mock('expo-secure-store', () => ({ deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('./swapPendingMerge', () => ({ markSwapPlaceholdersResolved: jest.fn() }));
jest.mock('../services/boltzService', () => ({
  waitForSubmarineSwapComplete: jest.fn(),
  isExplicitSwapFailure: (e: unknown) =>
    e instanceof Error && e.message.startsWith('Swap failed with status: '),
}));

import * as boltzService from '../services/boltzService';
import { markSwapPlaceholdersResolved } from './swapPendingMerge';
import {
  FORWARD_SWAP_WATCH_TIMEOUT_MS,
  forwardSwapStatusMessage,
  forwardSwapStillWaitingToast,
  watchForwardSwap,
} from './forwardSwapWatch';

const wait = boltzService.waitForSubmarineSwapComplete as jest.Mock;

const watchArgs = () => ({
  swapId: 'swap1',
  invoiceSats: 20_000,
  onMessage: jest.fn(),
  refreshWallets: jest.fn(async () => undefined),
  onFailed: jest.fn(async () => undefined),
});

beforeEach(() => jest.clearAllMocks());

describe('forward swap timing (#1179)', () => {
  it('watches long enough for a slow block, not a fixed 15 min', () => {
    // P(no block in t) = e^(-t/10min): 15 min → ~22% of normal swaps.
    expect(FORWARD_SWAP_WATCH_TIMEOUT_MS).toBeGreaterThanOrEqual(60 * 60_000);
  });

  it('narrates the confirmation wait, then the payment', () => {
    expect(forwardSwapStatusMessage('transaction.mempool')).toMatch(
      /Waiting for 1 confirmation \(~10 min typical\)/,
    );
    expect(forwardSwapStatusMessage('transaction.confirmed')).toMatch(/Boltz is paying/);
    expect(forwardSwapStatusMessage('invoice.pending')).toMatch(/Boltz is paying/);
    expect(forwardSwapStatusMessage('invoice.set')).toBeNull();
  });

  it('a timeout before the confirmation reads as block time, not a problem', () => {
    expect(forwardSwapStillWaitingToast('transaction.mempool').text1).toBe(
      'Still waiting for a confirmation',
    );
    expect(forwardSwapStillWaitingToast(null).text1).toBe('Still waiting for a confirmation');
    expect(forwardSwapStillWaitingToast('transaction.confirmed').text1).toBe('Swap still settling');
  });
});

describe('watchForwardSwap', () => {
  it('relays each Boltz status to the sheet and finishes with a refresh', async () => {
    wait.mockImplementation(async (_id, _timeout, onStatus) => {
      onStatus('transaction.mempool');
      onStatus('transaction.confirmed');
      onStatus('transaction.claim.pending');
    });
    const args = watchArgs();
    await watchForwardSwap(args);
    expect(wait).toHaveBeenCalledWith('swap1', FORWARD_SWAP_WATCH_TIMEOUT_MS, expect.any(Function));
    const messages = args.onMessage.mock.calls.map(([m]) => m as string);
    expect(messages[0]).toMatch(/Waiting for 1 confirmation/);
    expect(messages[1]).toMatch(/Boltz is paying/);
    expect(messages[2]).toMatch(/Swap complete — 20,000 sats/);
    expect(markSwapPlaceholdersResolved).toHaveBeenCalledWith('swap1');
    expect(args.refreshWallets).toHaveBeenCalled();
    expect(mockToastShow).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('a timeout in the mempool is an info "still waiting", never a failure or refund', async () => {
    wait.mockImplementation(async (_id, _timeout, onStatus) => {
      onStatus('transaction.mempool');
      throw new Error('Timeout waiting for swap swap1 after 3600s');
    });
    const args = watchArgs();
    await watchForwardSwap(args);
    expect(args.onFailed).not.toHaveBeenCalled();
    expect(markSwapPlaceholdersResolved).not.toHaveBeenCalled();
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', text1: 'Still waiting for a confirmation' }),
    );
  });

  it('an explicit Boltz failure resolves the placeholder and goes to refund', async () => {
    wait.mockRejectedValue(new Error('Swap failed with status: transaction.lockupFailed'));
    const args = watchArgs();
    await watchForwardSwap(args);
    expect(markSwapPlaceholdersResolved).toHaveBeenCalledWith('swap1');
    expect(args.onFailed).toHaveBeenCalledWith('Swap failed with status: transaction.lockupFailed');
  });
});
