import { deriveShopOrders, ordersNeedingInvoice, type OrderRowInput } from './shopOrders';
import { serializeOrder, type ParsedOrderEvent } from './orderEvents';

const SELLER = 'a'.repeat(64);
const OTHER_SELLER = 'b'.repeat(64);
const BUYER = 'c'.repeat(64);
const BUYER2 = 'd'.repeat(64);

const order = (patch: Partial<ParsedOrderEvent>): string =>
  serializeOrder({
    kind: 16,
    type: 'order',
    orderId: 'o1',
    items: [{ ref: `30402:${SELLER}:mug`, quantity: 2 }],
    message: '',
    ...patch,
  });

const row = (patch: Partial<OrderRowInput>): OrderRowInput => ({
  eventId: 'e1',
  conversation: BUYER,
  createdAt: 100,
  content: order({}),
  fromMe: false,
  wireKind: 16,
  ...patch,
});

describe('deriveShopOrders', () => {
  it('lists incoming orders for my own listings with their titles', () => {
    const orders = deriveShopOrders(
      [row({ content: order({ amountSats: 2100 }) })],
      SELLER,
      new Map([['mug', 'Piggy mug']]),
    );
    expect(orders).toEqual([
      {
        key: `${BUYER}:o1`,
        orderId: 'o1',
        eventId: 'e1',
        buyer: BUYER,
        createdAt: 100,
        lines: [{ ref: `30402:${SELLER}:mug`, dTag: 'mug', title: 'Piggy mug', quantity: 2 }],
        amountSats: 2100,
        invoiceSent: false,
      },
    ]);
  });

  it('falls back to the d tag when the listing is gone, and keeps colons in it', () => {
    const [o] = deriveShopOrders(
      [
        row({
          content: order({ items: [{ ref: `30402:${SELLER.toUpperCase()}:a:b`, quantity: 1 }] }),
        }),
      ],
      SELLER,
    );
    expect(o.lines[0]).toMatchObject({ dTag: 'a:b', title: 'a:b' });
  });

  it("ignores other sellers' items, my own outgoing orders and non-order rows", () => {
    const orders = deriveShopOrders(
      [
        row({ content: order({ items: [{ ref: `30402:${OTHER_SELLER}:x`, quantity: 1 }] }) }),
        row({ eventId: 'mine', fromMe: true }),
        row({ eventId: 'status', content: order({ type: 'status', status: 'shipped' }) }),
        row({ eventId: 'text', wireKind: 14, content: 'hello' }),
        row({ eventId: 'junk', content: 'not json' }),
      ],
      SELLER,
    );
    expect(orders).toEqual([]);
  });

  it('keeps only my lines from a mixed order', () => {
    const [o] = deriveShopOrders(
      [
        row({
          content: order({
            items: [
              { ref: `30402:${OTHER_SELLER}:x`, quantity: 1 },
              { ref: `30402:${SELLER}:mug`, quantity: 3 },
            ],
          }),
        }),
      ],
      SELLER,
    );
    expect(o.lines.map((l) => l.dTag)).toEqual(['mug']);
  });

  it('marks an order invoiced once I sent a payment request for it', () => {
    const orders = deriveShopOrders(
      [
        row({}),
        row({
          eventId: 'e2',
          conversation: BUYER2,
          createdAt: 200,
          content: order({ orderId: 'o2' }),
        }),
        row({ eventId: 'inv', fromMe: true, createdAt: 150, content: order({ type: 'payment' }) }),
      ],
      SELLER,
    );
    expect(orders.map((o) => [o.orderId, o.invoiceSent])).toEqual([
      ['o2', false],
      ['o1', true],
    ]);
    expect(ordersNeedingInvoice(orders)).toBe(1);
  });

  it('does not let an invoice to one buyer mark another buyer’s order with the same id', () => {
    const orders = deriveShopOrders(
      [
        row({}),
        row({
          eventId: 'inv',
          conversation: BUYER2,
          fromMe: true,
          content: order({ type: 'payment' }),
        }),
      ],
      SELLER,
    );
    expect(orders[0].invoiceSent).toBe(false);
  });

  it('collapses a re-sent order onto its first message', () => {
    const orders = deriveShopOrders(
      [row({ eventId: 'later', createdAt: 300 }), row({ eventId: 'first', createdAt: 100 })],
      SELLER,
    );
    expect(orders).toHaveLength(1);
    expect(orders[0].eventId).toBe('first');
  });
});
