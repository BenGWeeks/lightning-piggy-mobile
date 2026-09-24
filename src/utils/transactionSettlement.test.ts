import { isTransactionSettled } from './transactionSettlement';

it('accepts explicit settlement without a timestamp', () => {
  expect(isTransactionSettled({ settled: true })).toBe(true);
});
it('retains a wallet explicit pending state over a timestamp', () => {
  expect(isTransactionSettled({ settled: false, settled_at: 123 })).toBe(false);
});
it('uses confirmed block height for on-chain history', () => {
  expect(isTransactionSettled({ blockHeight: 968400 })).toBe(true);
  expect(isTransactionSettled({ blockHeight: 0 })).toBe(false);
});
it('does not treat a zero or absent timestamp as settled', () => {
  expect(isTransactionSettled({ settled_at: 0 })).toBe(false);
  expect(isTransactionSettled({})).toBe(false);
});
