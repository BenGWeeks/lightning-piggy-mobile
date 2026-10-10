import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';
import uk from '../i18n/locales/uk.json';
import { isRowPending, pendingRowHintKey } from './transactionRowState';
import { swapIconState } from './swapIconState';
import type { WalletTransaction } from '../types/wallet';

const unsettledReverseLeg: WalletTransaction = {
  type: 'outgoing',
  amount: 64_000,
  settled: false,
  paymentHash: 'ab'.repeat(32),
  swapType: 'reverse',
};

describe('isRowPending', () => {
  it('a claimed reverse swap whose LN leg the wallet still holds is not pending (#1179)', () => {
    const icon = swapIconState(unsettledReverseLeg, {
      isBoltz: true,
      inAttention: false,
      claimed: true,
    });
    expect(icon).toBe('done');
    expect(isRowPending(unsettledReverseLeg, icon)).toBe(false);
  });

  it('an unsettled row without a done badge stays pending — and never carries a tick', () => {
    for (const flags of [
      { isBoltz: true, inAttention: false, claimed: false },
      { isBoltz: true, inAttention: true, claimed: false },
      { isBoltz: false, inAttention: false, claimed: false },
    ]) {
      const icon = swapIconState(unsettledReverseLeg, flags);
      expect(icon).not.toBe('done');
      expect(isRowPending(unsettledReverseLeg, icon)).toBe(true);
    }
  });

  it('a settled row is never pending', () => {
    expect(isRowPending({ settled: true }, undefined)).toBe(false);
    expect(isRowPending({ settled_at: 1_791_590_000 }, undefined)).toBe(false);
    expect(isRowPending({ blockHeight: 970_694 }, undefined)).toBe(false);
  });
});

describe('pendingRowHintKey', () => {
  it('hints "waiting for confirmation" on unconfirmed on-chain rows and forward swaps', () => {
    expect(pendingRowHintKey({ txid: 'a0133a5f' })).toBe('transactionList.awaitingConfirmation');
    expect(pendingRowHintKey({ swapType: 'submarine' })).toBe(
      'transactionList.awaitingConfirmation',
    );
  });

  it('no hint on a Lightning row or a reverse swap placeholder', () => {
    expect(pendingRowHintKey({})).toBeNull();
    expect(pendingRowHintKey({ swapType: 'reverse' })).toBeNull();
  });

  it.each([
    ['en', en],
    ['es', es],
    ['uk', uk],
  ])('the hint is translated in %s', (_locale, strings) => {
    const section = (strings as unknown as Record<string, Record<string, string>>).transactionList;
    expect(section.awaitingConfirmation).toEqual(expect.any(String));
  });
});
