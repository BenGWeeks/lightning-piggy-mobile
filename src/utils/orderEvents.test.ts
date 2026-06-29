import {
  parseOrderEvent,
  isOrderEvent,
  serializeOrder,
  parseStoredOrder,
  orderPreviewText,
  orderPreviewFromContent,
  orderCardHeader,
  shortOrderId,
  type OrderEventInput,
} from './orderEvents';

// Realistic Gamma/Plebeian-market events, verified live on relays.
const orderPlaced: OrderEventInput = {
  kind: 16,
  content: 'Order created',
  tags: [
    ['p', 'a'.repeat(64)],
    ['subject', 'order-info'],
    ['type', '1'],
    ['order', 'c6c790ca-1234-4abc-9def-0123456789ab'],
    ['amount', '21'],
    ['item', '30402:' + 'b'.repeat(64) + ':widget', '2'],
    ['shipping', '30406:' + 'b'.repeat(64) + ':ship-uk'],
  ],
};

const paymentRequest: OrderEventInput = {
  kind: 16,
  content: 'Please pay this invoice...',
  tags: [
    ['p', 'a'.repeat(64)],
    ['type', '2'],
    ['order', 'c6c790ca-1234-4abc-9def-0123456789ab'],
    ['amount', '21'],
    ['payment', 'lightning', 'lnbc210n1pexample'],
  ],
};

const statusUpdate: OrderEventInput = {
  kind: 16,
  content: 'Order status updated to confirmed',
  tags: [
    ['type', '3'],
    ['order', 'c6c790ca'],
    ['status', 'confirmed'],
  ],
};

const shippingUpdate: OrderEventInput = {
  kind: 16,
  content: 'Shipped',
  tags: [
    ['type', '4'],
    ['order', 'c6c790ca'],
    ['status', 'shipped'],
    ['tracking', 'TRACK123'],
  ],
};

const receipt: OrderEventInput = {
  kind: 17,
  content: 'Seller payment for 1 items',
  tags: [
    ['subject', 'order-receipt'],
    ['order', 'c6c790ca'],
    ['payment', 'lightning', 'lnbc210n1pexample', 'preimage_deadbeef'],
    ['amount', '21'],
  ],
};

// NIP-18 generic repost — same kind 16, must be rejected.
const repostAlt: OrderEventInput = {
  kind: 16,
  content: '{"id":"...","kind":1,"content":"hi"}',
  tags: [
    ['p', 'a'.repeat(64)],
    ['e', 'c'.repeat(64)],
    ['alt', 'Generic repost'],
  ],
};
const repostK: OrderEventInput = {
  kind: 16,
  content: '{}',
  tags: [
    ['e', 'c'.repeat(64)],
    ['k', '1'],
  ],
};

describe('parseOrderEvent', () => {
  it('parses an order-placed (type 1)', () => {
    const o = parseOrderEvent(orderPlaced);
    expect(o).not.toBeNull();
    expect(o!.type).toBe('order');
    expect(o!.kind).toBe(16);
    expect(o!.orderId).toBe('c6c790ca-1234-4abc-9def-0123456789ab');
    expect(o!.amountSats).toBe(21);
    expect(o!.items).toEqual([{ ref: '30402:' + 'b'.repeat(64) + ':widget', quantity: 2 }]);
    expect(o!.shipping).toBe('30406:' + 'b'.repeat(64) + ':ship-uk');
    expect(o!.message).toBe('Order created');
  });

  it('parses a payment request (type 2) with payment detail', () => {
    const o = parseOrderEvent(paymentRequest)!;
    expect(o.type).toBe('payment');
    expect(o.payment).toEqual({ method: 'lightning', value: 'lnbc210n1pexample' });
  });

  it('parses a status update (type 3)', () => {
    const o = parseOrderEvent(statusUpdate)!;
    expect(o.type).toBe('status');
    expect(o.status).toBe('confirmed');
  });

  it('parses a shipping update (type 4) with tracking', () => {
    const o = parseOrderEvent(shippingUpdate)!;
    expect(o.type).toBe('shipping');
    expect(o.status).toBe('shipped');
    expect(o.tracking).toBe('TRACK123');
  });

  it('parses a kind-17 receipt with payment preimage', () => {
    const o = parseOrderEvent(receipt)!;
    expect(o.type).toBe('receipt');
    expect(o.kind).toBe(17);
    expect(o.payment).toEqual({
      method: 'lightning',
      value: 'lnbc210n1pexample',
      preimage: 'preimage_deadbeef',
    });
    expect(o.amountSats).toBe(21);
  });

  it('rejects a NIP-18 repost advertised via an alt tag', () => {
    expect(parseOrderEvent(repostAlt)).toBeNull();
  });

  it('rejects a NIP-18 repost carrying a k (repost-target-kind) tag', () => {
    expect(parseOrderEvent(repostK)).toBeNull();
  });

  it('rejects a kind-16 with no type tag', () => {
    expect(parseOrderEvent({ kind: 16, content: '', tags: [['order', 'x']] })).toBeNull();
  });

  it('rejects a kind-16 order tag missing', () => {
    expect(parseOrderEvent({ kind: 16, content: '', tags: [['type', '1']] })).toBeNull();
  });

  it('rejects an unrelated kind', () => {
    expect(parseOrderEvent({ kind: 1, content: 'note', tags: [] })).toBeNull();
  });

  it('rejects a kind-17 without the order-receipt subject (e.g. a NIP-25 website reaction)', () => {
    expect(parseOrderEvent({ kind: 17, content: '+', tags: [['order', 'c6c790ca']] })).toBeNull();
    expect(
      parseOrderEvent({
        kind: 17,
        content: '',
        tags: [
          ['order', 'c6c790ca'],
          ['subject', 'something-else'],
        ],
      }),
    ).toBeNull();
  });

  it('ignores a non-numeric amount', () => {
    const o = parseOrderEvent({
      kind: 16,
      content: '',
      tags: [
        ['type', '1'],
        ['order', 'x'],
        ['amount', 'free'],
      ],
    })!;
    expect(o.amountSats).toBeUndefined();
  });

  it('defaults item quantity to 1 when omitted', () => {
    const o = parseOrderEvent({
      kind: 16,
      content: '',
      tags: [
        ['type', '1'],
        ['order', 'x'],
        ['item', '30402:pk:a'],
      ],
    })!;
    expect(o.items).toEqual([{ ref: '30402:pk:a', quantity: 1 }]);
  });
});

describe('isOrderEvent', () => {
  it('is true for orders, false for reposts', () => {
    expect(isOrderEvent(orderPlaced)).toBe(true);
    expect(isOrderEvent(receipt)).toBe(true);
    expect(isOrderEvent(repostAlt)).toBe(false);
  });
});

describe('serialize / parseStoredOrder round-trip', () => {
  it('round-trips every variant', () => {
    for (const ev of [orderPlaced, paymentRequest, statusUpdate, shippingUpdate, receipt]) {
      const o = parseOrderEvent(ev)!;
      const restored = parseStoredOrder(serializeOrder(o));
      expect(restored).toEqual(o);
    }
  });

  it('returns null for non-order JSON', () => {
    expect(parseStoredOrder('hello world')).toBeNull();
    expect(parseStoredOrder('{"foo":1}')).toBeNull();
  });

  it('rejects a stored row with an off-schema type', () => {
    expect(parseStoredOrder('{"kind":16,"orderId":"x","type":"bogus"}')).toBeNull();
  });

  it('coerces a missing/invalid item quantity to 1', () => {
    const restored = parseStoredOrder(
      '{"kind":16,"orderId":"x","type":"order","items":[{"ref":"a"},{"ref":"b","quantity":"7"}]}',
    );
    expect(restored!.items).toEqual([
      { ref: 'a', quantity: 1 },
      { ref: 'b', quantity: 1 },
    ]);
  });
});

describe('orderPreviewText', () => {
  it('summarises an order with amount', () => {
    expect(orderPreviewText(parseOrderEvent(orderPlaced)!)).toBe('🛒 Order Placed · 21 sats');
  });
  it('summarises a status update with status', () => {
    expect(orderPreviewText(parseOrderEvent(statusUpdate)!)).toBe(
      '📋 Order Status Update · confirmed',
    );
  });
  it('summarises a receipt with amount', () => {
    expect(orderPreviewText(parseOrderEvent(receipt)!)).toBe('🧾 Payment Receipt · 21 sats');
  });
});

describe('orderPreviewFromContent', () => {
  it('derives a preview for a stored order row', () => {
    const stored = serializeOrder(parseOrderEvent(orderPlaced)!);
    expect(orderPreviewFromContent(stored, 16)).toBe('🛒 Order Placed · 21 sats');
  });
  it('passes plain text through for non-order rows', () => {
    expect(orderPreviewFromContent('hello', 14)).toBe('hello');
  });
});

describe('helpers', () => {
  it('orderCardHeader maps types to emoji + label', () => {
    expect(orderCardHeader('order')).toEqual({ emoji: '🛒', label: 'Order Placed' });
    expect(orderCardHeader('receipt')).toEqual({ emoji: '🧾', label: 'Payment Receipt' });
  });
  it('shortOrderId strips dashes and truncates', () => {
    expect(shortOrderId('c6c790ca-1234-4abc')).toBe('c6c790ca');
  });
});
