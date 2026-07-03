// Stub the swap-meta lookup so the test stays independent of the heavy
// swapRecoveryService. Default per test via mockGetSwapMeta.
const mockGetSwapMeta = jest.fn();
jest.mock('../services/swapRecoveryService', () => ({
  getSwapMeta: (key: string) => mockGetSwapMeta(key),
}));

import { mapOnchainTransactions } from './onchainTransactions';
import type { OnchainTransaction } from '../services/onchainService';

const tx = (over: Partial<OnchainTransaction> = {}): OnchainTransaction => ({
  txid: 't1',
  type: 'incoming',
  amount: 1000,
  confirmed: true,
  blockHeight: 100,
  timestamp: 123,
  ...over,
});

beforeEach(() => mockGetSwapMeta.mockReset());

describe('mapOnchainTransactions (#895)', () => {
  it('tags a reverse-swap claim leg (incoming) by txid', () => {
    mockGetSwapMeta.mockImplementation((k: string) =>
      k === 'claim1' ? { swapId: 'sw', swapType: 'reverse' } : undefined,
    );
    const [r] = mapOnchainTransactions([tx({ txid: 'claim1', type: 'incoming' })]);
    expect(r.swapId).toBe('sw');
    expect(r.swapType).toBe('reverse');
    expect(r.description).toBe('Boltz swap — received on-chain');
  });

  it('tags a submarine lockup leg (outgoing) by txid', () => {
    mockGetSwapMeta.mockImplementation((k: string) =>
      k === 'lock1' ? { swapId: 'sw', swapType: 'submarine' } : undefined,
    );
    const [r] = mapOnchainTransactions([tx({ txid: 'lock1', type: 'outgoing' })]);
    expect(r.swapId).toBe('sw');
    expect(r.swapType).toBe('submarine');
    expect(r.description).toBe('Boltz swap — sent on-chain');
  });

  it('leaves a non-swap confirmed tx as a plain Received/Sent', () => {
    mockGetSwapMeta.mockReturnValue(undefined);
    expect(mapOnchainTransactions([tx({ type: 'incoming' })])[0].description).toBe('Received');
    expect(mapOnchainTransactions([tx({ type: 'outgoing' })])[0].description).toBe('Sent');
  });

  it('uses Pending for an unconfirmed non-swap tx', () => {
    mockGetSwapMeta.mockReturnValue(undefined);
    const [r] = mapOnchainTransactions([tx({ confirmed: false })]);
    expect(r.description).toBe('Pending');
    expect(r.swapId).toBeUndefined();
  });
});
