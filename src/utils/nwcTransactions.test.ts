// Stub the swap-meta lookup so the test stays independent of the heavy
// swapRecoveryService (bitcoinjs/secp256k1/SecureStore). Default: no swap.
const mockGetSwapMeta = jest.fn();
jest.mock('../services/swapRecoveryService', () => ({
  getSwapMeta: (key: string) => mockGetSwapMeta(key),
}));

import { mapNwcTransactions, type NwcRawTransaction } from './nwcTransactions';
import type { WalletTransaction } from '../types/wallet';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

beforeEach(() => mockGetSwapMeta.mockReset());

const raw = (p: Partial<NwcRawTransaction>): NwcRawTransaction => ({
  type: 'incoming',
  amount: 0,
  ...p,
});

describe('mapNwcTransactions', () => {
  it('maps fields and normalises null to undefined', () => {
    const [tx] = mapNwcTransactions(
      [
        raw({
          type: 'incoming',
          amount: 111,
          description: null,
          settled_at: 100,
          created_at: null,
          invoice: 'lnbc1',
          payment_hash: H1,
          preimage: 'pre',
        }),
      ],
      [],
    );
    expect(tx).toMatchObject({
      type: 'incoming',
      amount: 111,
      description: undefined,
      settled_at: 100,
      created_at: undefined,
      bolt11: 'lnbc1',
      invoice: 'lnbc1',
      paymentHash: H1,
      preimage: 'pre',
    });
  });

  it('converts fees from msats to sats (rounded)', () => {
    const [tx] = mapNwcTransactions([raw({ payment_hash: H1, fees_paid: 1500 })], []);
    expect(tx.feesSats).toBe(2);
  });

  it('omits feesSats when fees_paid is absent', () => {
    const [tx] = mapNwcTransactions([raw({ payment_hash: H1 })], []);
    expect(tx.feesSats).toBeUndefined();
  });

  it('carries forward a previously resolved zap counterparty by hash', () => {
    const existing: WalletTransaction[] = [
      { type: 'incoming', amount: 1, paymentHash: H1, zapCounterparty: null },
    ];
    const [tx] = mapNwcTransactions([raw({ payment_hash: H1, amount: 1 })], existing);
    expect(tx.zapCounterparty).toBeNull();
  });

  it('preserves an optimistic row the server has not yet returned', () => {
    const existing: WalletTransaction[] = [
      {
        type: 'outgoing',
        amount: 50,
        paymentHash: H2,
        settled_at: 200,
        optimistic: true,
      },
    ];
    // Server only returns an unrelated incoming row.
    const result = mapNwcTransactions(
      [raw({ type: 'incoming', amount: 10, payment_hash: H1, settled_at: 100 })],
      existing,
    );
    expect(result).toHaveLength(2);
    // Newest-first ordering: the optimistic outgoing (settled_at 200) leads.
    expect(result[0]).toMatchObject({ paymentHash: H2, optimistic: true });
    expect(result[1]).toMatchObject({ paymentHash: H1 });
  });

  it('drops an optimistic row once the server returns the same type+hash', () => {
    const existing: WalletTransaction[] = [
      { type: 'outgoing', amount: 50, paymentHash: H1, optimistic: true },
    ];
    const result = mapNwcTransactions(
      [raw({ type: 'outgoing', amount: 50, payment_hash: H1, settled_at: 100 })],
      existing,
    );
    expect(result).toHaveLength(1);
    expect(result[0].optimistic).toBeUndefined();
  });

  it('keeps an optimistic leg when only the opposite leg of a self-pay returns', () => {
    // A self-pay has incoming + outgoing legs sharing one hash; keying on hash
    // alone would wrongly drop our optimistic outgoing leg when the incoming
    // leg comes back. Matching on type+hash keeps it.
    const existing: WalletTransaction[] = [
      { type: 'outgoing', amount: 50, paymentHash: H1, optimistic: true },
    ];
    const result = mapNwcTransactions(
      [raw({ type: 'incoming', amount: 50, payment_hash: H1, settled_at: 100 })],
      existing,
    );
    expect(result.some((t) => t.type === 'outgoing' && t.optimistic)).toBe(true);
  });

  describe('Boltz swap tagging (#895)', () => {
    it('tags the LN leg when its payment hash is a known swap', () => {
      mockGetSwapMeta.mockImplementation((k: string) =>
        k === H1 ? { swapId: 'sw1', swapType: 'submarine' } : undefined,
      );
      const [r] = mapNwcTransactions([raw({ type: 'incoming', amount: 50, payment_hash: H1 })], []);
      expect(r.swapId).toBe('sw1');
      expect(r.swapType).toBe('submarine');
      expect(r.description).toBe('Boltz swap — received via Lightning');
    });

    it('leaves a non-swap tx untagged with its original description', () => {
      mockGetSwapMeta.mockReturnValue(undefined);
      const [r] = mapNwcTransactions(
        [raw({ type: 'incoming', amount: 50, payment_hash: H2, description: 'Received' })],
        [],
      );
      expect(r.swapId).toBeUndefined();
      expect(r.description).toBe('Received');
    });
  });
});
