// Stub the swap-meta lookup so the test stays independent of the heavy
// swapRecoveryService (bitcoinjs/secp256k1/SecureStore). Default: no swap.
const mockGetSwapMeta = jest.fn();
jest.mock('../services/swapRecoveryService', () => ({
  getSwapMeta: (key: string) => mockGetSwapMeta(key),
}));

import { mapNwcTransactions, type NwcRawTransaction } from './nwcTransactions';
import { isTransactionSettled } from './transactionSettlement';
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

  it('preserves fees already converted to sats by the WebLN SDK', () => {
    const [tx] = mapNwcTransactions([raw({ payment_hash: H1, fees_paid: 55 })], []);
    expect(tx.feesSats).toBe(55);
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

    it('replaces a settled swap placeholder with its real leg, keeping unrelated pending rows', () => {
      mockGetSwapMeta.mockImplementation((k: string) =>
        k === H1 ? { swapId: 'rev1', swapType: 'reverse' } : undefined,
      );
      const now = Math.floor(Date.now() / 1000);
      const placeholder = (swapId: string): WalletTransaction => ({
        type: 'outgoing',
        amount: 30000,
        description: 'Boltz swap in progress',
        created_at: now - 60,
        settled_at: null,
        swapId,
        swapType: 'reverse',
        optimistic: true,
      });
      const pendingZap: WalletTransaction = {
        type: 'outgoing',
        amount: 21,
        paymentHash: H2,
        created_at: now - 5,
        optimistic: true,
      };
      const txs = mapNwcTransactions(
        [raw({ type: 'outgoing', amount: 30000, payment_hash: H1, settled_at: now })],
        [placeholder('rev1'), placeholder('rev2'), pendingZap],
      );
      expect(txs.filter((t) => t.swapId === 'rev1')).toEqual([
        expect.objectContaining({
          paymentHash: H1,
          description: 'Boltz swap — sent via Lightning',
        }),
      ]);
      expect(txs).toContainEqual(placeholder('rev2'));
      expect(txs).toContainEqual(pendingZap);
      expect(txs).toHaveLength(3);
    });
  });
});

describe('Coinos settlement without settled_at', () => {
  it('shows a settled outgoing response as confirmed without inventing a timestamp', () => {
    const [tx] = mapNwcTransactions(
      [
        raw({
          type: 'outgoing',
          amount: 11000,
          state: 'settled',
          created_at: 1790262724,
          fees_paid: 55,
          payment_hash: H1,
        }),
      ],
      [],
    );
    expect(isTransactionSettled(tx)).toBe(true);
    expect(tx.settled_at).toBeUndefined();
    expect(tx.created_at).toBe(1790262724);
    expect(tx.feesSats).toBe(55);
  });

  it.each(['pending', 'failed', 'expired', 'unknown', undefined])(
    'does not confirm a %s response merely because it has a preimage and creation time',
    (state) => {
      const [tx] = mapNwcTransactions(
        [raw({ state, created_at: 123, preimage: 'a'.repeat(64), payment_hash: H1 })],
        [],
      );
      expect(isTransactionSettled(tx)).toBe(false);
    },
  );

  it('still confirms legacy providers that supply only settled_at', () => {
    const [tx] = mapNwcTransactions([raw({ settled_at: 123 })], []);
    expect(isTransactionSettled(tx)).toBe(true);
  });

  it('replaces pending state with settled state on the next wallet refresh', () => {
    const pending = mapNwcTransactions([raw({ state: 'pending', payment_hash: H1 })], []);
    const [settled] = mapNwcTransactions([raw({ state: 'settled', payment_hash: H1 })], pending);
    expect(isTransactionSettled(settled)).toBe(true);
  });
});
