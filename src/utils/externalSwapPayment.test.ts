import { formatBtcSats, buildBoltzBip21Uri, canPayExternalSwap } from './externalSwapPayment';

test.each([
  [1, '0.00000001'],
  [26001, '0.00026001'],
  [100000000, '1'],
  [2100000000000000, '21000000'],
])('formats %s sats exactly as %s BTC', (sats, btc) => {
  expect(formatBtcSats(Number(sats))).toBe(btc);
  expect(buildBoltzBip21Uri('bc1qfixture', Number(sats))).toBe(`bitcoin:bc1qfixture?amount=${btc}`);
});
test.each([0, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid amount %s instead of rounding payment instructions',
  (amount) => {
    expect(() => formatBtcSats(amount)).toThrow();
  },
);
test('requires a payment address', () => expect(() => buildBoltzBip21Uri('', 1)).toThrow());
test('stops payment at the timeout block and fails closed on unknown chain or swap status', () => {
  expect(canPayExternalSwap('swap.created', 99, 100, 'swap.created')).toBe(true);
  expect(canPayExternalSwap('invoice.set', 99, 100, 'invoice.set')).toBe(true);
  expect(canPayExternalSwap('swap.created', 100, 100, 'swap.created')).toBe(false);
  expect(canPayExternalSwap('swap.created', null, 100, 'swap.created')).toBe(false);
  for (const status of [
    'unknown',
    'swap.expired',
    'invoice.failedToPay',
    'transaction.mempool',
    'transaction.claimed',
  ])
    expect(canPayExternalSwap(status, 99, 100, status)).toBe(false);
});

test('saved pending status and a successful height read cannot authorize payment', () => {
  expect(canPayExternalSwap('swap.created', 99, 100)).toBe(false);
  for (const liveStatus of ['transaction.mempool', 'invoice.failedToPay', null]) {
    expect(canPayExternalSwap('swap.created', 99, 100, liveStatus)).toBe(false);
  }
});
