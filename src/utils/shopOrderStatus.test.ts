import { bech32 } from 'bech32';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  needsInvoiceCount,
  preimageMatches,
  receiptProvesPayment,
  sellerOrderThreads,
  shopOrderEntries,
  shopOrderStatus,
} from './shopOrderStatus';
import { serializeOrder, type ParsedOrderEvent } from './orderEvents';
import type { OrderRowInput } from './orderThreads';

const BUYER = 'b'.repeat(64);
const NOW = 1_800_000_000;
function bolt11(hrp: string, timestamp = NOW, expiry?: number): string {
  const words = (value: number, length: number) =>
    Array.from({ length }, (_, i) => Math.floor(value / 32 ** (length - i - 1)) % 32);
  return bech32.encode(
    hrp,
    [
      ...words(timestamp, 7),
      1,
      1,
      20,
      ...bech32.toWords(Buffer.alloc(32, 1)),
      ...(expiry === undefined ? [] : [6, 0, 3, ...words(expiry, 3)]),
      ...Array(104).fill(0),
    ],
    2000,
  );
}
const BOLT11 = bolt11('lnbc21u');
const PREIMAGE = '11'.repeat(32);
const HASH = bytesToHex(sha256(Uint8Array.from(Array(32).fill(0x11))));

function row(
  fromMe: boolean,
  createdAt: number,
  order: Partial<ParsedOrderEvent> & Pick<ParsedOrderEvent, 'type'>,
): OrderRowInput {
  const full: ParsedOrderEvent = {
    kind: order.type === 'receipt' ? 17 : 16,
    orderId: 'o-1',
    items: [],
    message: '',
    ...order,
  };
  return {
    id: `r${createdAt}`,
    fromMe,
    createdAt,
    wireKind: full.kind,
    text: serializeOrder(full),
  };
}
const received = row(false, 10, { type: 'order', amountSats: 2100 });
const myInvoice = row(true, 20, {
  type: 'payment',
  amountSats: 2100,
  payment: { method: 'lightning', value: BOLT11 },
});
const thread = (rows: OrderRowInput[]) => sellerOrderThreads(rows).get('o-1')!;

describe('shopOrderStatus', () => {
  it('Needs invoice → Invoice sent → Paid → Shipped', () => {
    expect(shopOrderStatus(thread([received]))).toBe('needsInvoice');
    expect(shopOrderStatus(thread([received, myInvoice]))).toBe('invoiceSent');
    expect(shopOrderStatus(thread([received, myInvoice]), { walletPaid: true })).toBe('paid');
    expect(
      shopOrderStatus(
        thread([received, myInvoice, row(true, 30, { type: 'status', status: 'confirmed' })]),
      ),
    ).toBe('paid');
    expect(
      shopOrderStatus(
        thread([received, myInvoice, row(true, 40, { type: 'shipping', status: 'shipped' })]),
      ),
    ).toBe('shipped');
  });

  it('a buyer cancelling wins; a buyer can not mark it paid', () => {
    expect(
      shopOrderStatus(thread([received, row(false, 30, { type: 'status', status: 'cancelled' })])),
    ).toBe('cancelled');
    expect(
      shopOrderStatus(
        thread([received, myInvoice, row(false, 30, { type: 'status', status: 'confirmed' })]),
      ),
    ).toBe('invoiceSent');
  });

  it('counts orders needing an invoice', () => {
    expect(needsInvoiceCount(['needsInvoice', 'paid', 'needsInvoice', 'invoiceSent'])).toBe(2);
  });
});

describe('receipt verification', () => {
  it('a receipt proves payment only with my bolt11 and a matching preimage', () => {
    expect(preimageMatches(PREIMAGE, HASH)).toBe(true);
    expect(preimageMatches('22'.repeat(32), HASH)).toBe(false);
    expect(preimageMatches(undefined, HASH)).toBe(false);
    const good = thread([
      received,
      myInvoice,
      row(false, 30, {
        type: 'receipt',
        payment: { method: 'lightning', value: BOLT11, preimage: PREIMAGE },
      }),
    ]);
    expect(receiptProvesPayment(good, HASH)).toBe(true);
    expect(shopOrderStatus(good, { receiptVerified: receiptProvesPayment(good, HASH) })).toBe(
      'paid',
    );
    const otherInvoice = thread([
      received,
      myInvoice,
      row(false, 30, {
        type: 'receipt',
        payment: { method: 'lightning', value: `lnbc1${'z'.repeat(60)}`, preimage: PREIMAGE },
      }),
    ]);
    expect(receiptProvesPayment(otherInvoice, HASH)).toBe(false);
  });
});

it('shopOrderEntries lists received orders newest first with chips and jump rows', () => {
  const second = row(false, 50, { type: 'order', orderId: 'o-2' });
  const entries = shopOrderEntries(
    new Map([
      [BUYER, [received, myInvoice]],
      ['c'.repeat(64), [second]],
    ]),
    new Set(['o-1']),
  );
  expect(entries.map((e) => [e.orderId, e.status, e.jumpToRowId])).toEqual([
    ['o-2', 'needsInvoice', 'r50'],
    ['o-1', 'paid', 'r10'],
  ]);
});
