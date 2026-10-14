import {
  buyerOrderEntries,
  buyerOrderStatus,
  groupRowsByConversation,
  orderThreads,
  payNowCount,
  type OrderRowInput,
} from './orderThreads';
import { serializeOrder, type ParsedOrderEvent } from './orderEvents';

const SELLER = 'b'.repeat(64);
// A syntactically valid bolt11 for payableBolt11 (regex-only check).
const BOLT11 = `lnbc210n1${'q'.repeat(60)}`;

function row(
  fromMe: boolean,
  createdAt: number,
  order: Partial<ParsedOrderEvent> & Pick<ParsedOrderEvent, 'type'>,
  id = `r${createdAt}`,
): OrderRowInput {
  const full: ParsedOrderEvent = {
    kind: order.type === 'receipt' ? 17 : 16,
    orderId: 'o-1',
    items: [],
    message: '',
    ...order,
  };
  return { id, fromMe, createdAt, wireKind: full.kind, text: serializeOrder(full) };
}
const placed = (fromMe: boolean) =>
  row(fromMe, 10, {
    type: 'order',
    amountSats: 2100,
    items: [{ ref: `30402:${SELLER}:mug`, quantity: 2 }],
  });
const invoice = (fromMe: boolean) =>
  row(fromMe, 20, {
    type: 'payment',
    amountSats: 2100,
    payment: { method: 'lightning', value: BOLT11 },
  });

describe('orderThreads — direction-aware', () => {
  it('buyer role keeps orders I placed and reads the seller replies', () => {
    const threads = orderThreads([placed(true), invoice(false)], 'buyer');
    expect([...threads.keys()]).toEqual(['o-1']);
    expect(threads.get('o-1')).toMatchObject({
      role: 'buyer',
      placedAt: 10,
      placedRowId: 'r10',
      invoice: { bolt11: BOLT11, amountSats: 2100, rowId: 'r20' },
    });
  });

  it('seller role keeps orders I received and reads my replies', () => {
    const threads = orderThreads([placed(false), invoice(true)], 'seller');
    expect(threads.get('o-1')?.invoice?.bolt11).toBe(BOLT11);
    // Viewed from the wrong side there is no order.
    expect(orderThreads([placed(false), invoice(true)], 'buyer').size).toBe(0);
  });

  it('ignores a payment request from the buyer side and non-order rows', () => {
    const threads = orderThreads(
      [placed(true), invoice(true), { fromMe: false, text: 'hello', createdAt: 5, wireKind: 14 }],
      'buyer',
    );
    expect(threads.get('o-1')?.invoice).toBeUndefined();
  });

  it('either side can cancel; only the merchant sets status / shipping', () => {
    const threads = orderThreads(
      [
        placed(true),
        row(true, 30, { type: 'status', status: 'confirmed' }), // buyer can't confirm
        row(false, 40, { type: 'shipping', status: 'shipped' }),
      ],
      'buyer',
    );
    expect(threads.get('o-1')?.status).toBeUndefined();
    expect(threads.get('o-1')?.shipping).toBe('shipped');
    const cancelled = orderThreads(
      [placed(true), row(true, 30, { type: 'status', status: 'cancelled' })],
      'buyer',
    );
    expect(cancelled.get('o-1')?.cancelled).toBe(true);
  });
});

describe('buyerOrderStatus', () => {
  const thread = (rows: OrderRowInput[]) => orderThreads(rows, 'buyer').get('o-1')!;

  it('walks Awaiting invoice → Pay now → Paid → Shipped → Completed', () => {
    expect(buyerOrderStatus(thread([placed(true)]))).toBe('awaitingInvoice');
    expect(buyerOrderStatus(thread([placed(true), invoice(false)]))).toBe('payNow');
    expect(buyerOrderStatus(thread([placed(true), invoice(false)]), { invoicePaid: true })).toBe(
      'paid',
    );
    expect(
      buyerOrderStatus(
        thread([
          placed(true),
          invoice(false),
          row(false, 30, { type: 'status', status: 'confirmed' }),
        ]),
      ),
    ).toBe('paid');
    expect(
      buyerOrderStatus(
        thread([
          placed(true),
          invoice(false),
          row(true, 25, { type: 'receipt', payment: { method: 'lightning', value: BOLT11 } }),
        ]),
      ),
    ).toBe('paid');
    expect(
      buyerOrderStatus(
        thread([placed(true), row(false, 40, { type: 'shipping', status: 'shipped' })]),
      ),
    ).toBe('shipped');
    expect(
      buyerOrderStatus(
        thread([placed(true), row(false, 50, { type: 'status', status: 'completed' })]),
      ),
    ).toBe('completed');
  });

  it('cancelled wins', () => {
    expect(
      buyerOrderStatus(
        thread([
          placed(true),
          invoice(false),
          row(false, 30, { type: 'status', status: 'cancelled' }),
        ]),
      ),
    ).toBe('cancelled');
  });
});

describe('buyerOrderEntries', () => {
  it('lists my orders newest first across sellers, jumping to the invoice when payable', () => {
    const other = 'c'.repeat(64);
    const older = row(true, 5, { type: 'order', orderId: 'o-0', items: [] }, 'old');
    const entries = buyerOrderEntries(
      new Map([
        [SELLER, [placed(true), invoice(false)]],
        [other, [older]],
      ]),
    );
    expect(entries.map((e) => [e.orderId, e.sellerPubkey, e.status, e.jumpToRowId])).toEqual([
      ['o-1', SELLER, 'payNow', 'r20'],
      ['o-0', other, 'awaitingInvoice', 'old'],
    ]);
    expect(payNowCount(entries)).toBe(1);
  });

  it('a paid invoice (wallet history) is no longer Pay now', () => {
    const entries = buyerOrderEntries(
      new Map([[SELLER, [placed(true), invoice(false)]]]),
      (bolt11) => bolt11 === BOLT11,
    );
    expect(entries[0]).toMatchObject({ status: 'paid', jumpToRowId: 'r10' });
  });

  it('groups store rows by conversation', () => {
    const rows = [
      { ...placed(true), conversation: SELLER },
      { ...invoice(false), conversation: SELLER },
      { ...placed(true), conversation: 'x' },
    ];
    const grouped = groupRowsByConversation(rows);
    expect(grouped.get(SELLER)).toHaveLength(2);
    expect(grouped.get('x')).toHaveLength(1);
  });
});
