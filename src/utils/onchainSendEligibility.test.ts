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

describe('direct sends BDK cannot fund', () => {
  const direct = { ...base, viaSwap: false, fees: null, balanceSats: 4851 } as const;
  it('shows the balance reason with the total BDK needed, not "fee unavailable"', () => {
    const result = onchainSendEligibility({
      ...direct,
      directShortfall: { neededSats: 20210, availableSats: 4851 },
    });
    expect(result).toEqual({
      canSend: false,
      reason: {
        key: 'sendSheet.swapInsufficientBalance',
        params: {
          total: (20210).toLocaleString(),
          amount: (20000).toLocaleString(),
          fee: (210).toLocaleString(),
          balance: (4851).toLocaleString(),
        },
      },
    });
  });
  it('falls back to the wallet balance when BDK omits what is available', () => {
    const result = onchainSendEligibility({
      ...direct,
      directShortfall: { neededSats: 20210, availableSats: null },
    });
    expect(result.reason?.params?.balance).toBe((4851).toLocaleString());
  });
  it('still names the balance as the problem when BDK gives no amounts', () => {
    expect(
      onchainSendEligibility({
        ...direct,
        directShortfall: { neededSats: null, availableSats: null },
      }),
    ).toEqual({ canSend: false, reason: { key: 'sendSheet.onchainInsufficientFunds' } });
  });
  it('ignores a direct shortfall for a swap send', () => {
    expect(
      onchainSendEligibility({ ...base, directShortfall: { neededSats: 1, availableSats: 0 } })
        .canSend,
    ).toBe(true);
  });
});
