import { bech32 } from 'bech32';
import { matchesExpectedOrderAmount } from './orderInvoiceAmount';

function invoice(hrp: string): string {
  return bech32.encode(
    hrp,
    [...Array(7).fill(0), 1, 1, 20, ...bech32.toWords(Buffer.alloc(32, 1)), ...Array(104).fill(0)],
    2000,
  );
}

test('accepts exactly the buyer-approved amount using real BOLT11 decoding', () => {
  expect(matchesExpectedOrderAmount(invoice('lnbc1u'), 100)).toBe(true);
});
test.each(['lnbc2u', 'lnbc500n', 'lnbc', 'lnbc1000010p'])(
  'rejects wrong or absent amount %s',
  (hrp) => {
    expect(matchesExpectedOrderAmount(invoice(hrp), 100)).toBe(false);
  },
);
test.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  'rejects missing/invalid approved amount %s',
  (amount) => {
    expect(matchesExpectedOrderAmount(invoice('lnbc1u'), amount)).toBe(false);
  },
);
test('rejects malformed invoices', () => {
  expect(matchesExpectedOrderAmount('bad', 100)).toBe(false);
});
