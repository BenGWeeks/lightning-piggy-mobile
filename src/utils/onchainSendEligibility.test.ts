import { onchainSendEligibility } from './onchainSendEligibility';
import type { SwapFees } from '../services/boltzService';
import { quoteExactRecipient } from './reverseSwapAmounts';

const fees: SwapFees = {
  percentage: 0.5,
  minerFee: 304,
  lockupMinerFee: 1000,
  minAmount: 1000,
  maxAmount: 1000000,
};
const base = {
  amountSats: 20000,
  balanceSats: 30000,
  viaSwap: true,
  loading: false,
  fees,
  directFeeSats: null,
  errorKey: null,
} as const;

it('requires a quote even after loading has finished', () => {
  const result = onchainSendEligibility({ ...base, fees: null });
  expect(result.canSend).toBe(false);
  expect(result.reason?.key).toBe('swapBackend.quoteFailed');
});
it('explains a missing swap server', () => {
  expect(
    onchainSendEligibility({ ...base, fees: null, errorKey: 'swapBackend.notConfigured' }),
  ).toEqual({ canSend: false, reason: { key: 'swapBackend.notConfigured' } });
});
it('withholds cached quotes while a replacement loads', () => {
  expect(onchainSendEligibility({ ...base, loading: true }).canSend).toBe(false);
});
it('requires a known balance', () => {
  expect(onchainSendEligibility({ ...base, balanceSats: null }).canSend).toBe(false);
});
it('blocks the reported 20000-sat send from a 4893-sat wallet', () => {
  expect(onchainSendEligibility({ ...base, balanceSats: 4893 })).toMatchObject({
    canSend: false,
    reason: { key: 'sendSheet.swapInsufficientBalance' },
  });
});
it('requires amount plus fees and permits the exact total', () => {
  const total = quoteExactRecipient(base.amountSats, fees).invoiceSats;
  expect(onchainSendEligibility({ ...base, balanceSats: total - 1 }).canSend).toBe(false);
  expect(onchainSendEligibility({ ...base, balanceSats: total })).toEqual({
    canSend: true,
    reason: null,
  });
});
it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid amount %s', (amountSats) => {
  expect(onchainSendEligibility({ ...base, amountSats }).canSend).toBe(false);
});
it('enforces server amount limits', () => {
  expect(onchainSendEligibility({ ...base, amountSats: 1000000 }).canSend).toBe(false);
});
it('requires a direct-wallet fee estimate without requiring a swap server', () => {
  const direct = { ...base, viaSwap: false, fees: null };
  expect(onchainSendEligibility(direct).canSend).toBe(false);
  expect(onchainSendEligibility({ ...direct, directFeeSats: 200 }).canSend).toBe(true);
  expect(
    onchainSendEligibility({ ...direct, directFeeSats: 200, balanceSats: 20199 }).canSend,
  ).toBe(false);
  expect(
    onchainSendEligibility({ ...direct, directFeeSats: 200, balanceSats: 20200 }).canSend,
  ).toBe(true);
});
