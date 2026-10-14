import { recordSellerInvoice } from '../services/sellerInvoiceStore';
import { getOutgoingOrderRows } from '../services/dmDb';
import { serializeOrder, parseOrderEvent } from '../utils/orderEvents';
import {
  admitOrderLifecycle,
  getDroppedOrderLifecycleCount,
  admitUnfollowedOrder,
  isBoundedOrderRumor,
  ORDER_RUMOR_RATE_LIMIT,
  ORDER_RUMOR_MAX_CHARS,
} from './orderRumorIngest';

jest.mock('../services/dmDb', () => ({ getOutgoingOrderRows: jest.fn() }));

it('caps the shared live/backfill account budget and permits retries in the next window', () => {
  for (let i = 0; i < ORDER_RUMOR_RATE_LIMIT; i++) {
    expect(admitUnfollowedOrder('rate-test', 1000)).toBe(true);
  }
  expect(admitUnfollowedOrder('rate-test', 1001)).toBe(false);
  expect(admitUnfollowedOrder('another-account', 1001)).toBe(true);
  expect(admitUnfollowedOrder('rate-test', 61000)).toBe(true);
});

it('caps content and tags, rejecting unrelated website reactions and reposts', () => {
  const order = {
    kind: 16,
    content: '',
    tags: [
      ['type', '2'],
      ['order', 'o'],
    ],
  };
  expect(isBoundedOrderRumor(order)).toBe(true);
  expect(isBoundedOrderRumor({ ...order, content: 'x'.repeat(ORDER_RUMOR_MAX_CHARS) })).toBe(false);
  expect(
    isBoundedOrderRumor({
      ...order,
      tags: [...order.tags, ['address', 'x'.repeat(ORDER_RUMOR_MAX_CHARS)]],
    }),
  ).toBe(false);
  expect(isBoundedOrderRumor({ ...order, tags: [...order.tags, ['k', '1']] })).toBe(false);
  expect(isBoundedOrderRumor({ ...order, kind: 17 })).toBe(false);
  expect(isBoundedOrderRumor({ ...order, kind: 14 })).toBe(false);
});

it.each(['2', '3', '4', 'receipt'])(
  'requires a placed order and its actual seller for lifecycle %s',
  async (type) => {
    const owner = `buyer-${type}`;
    const rumor = {
      kind: type === 'receipt' ? 17 : 16,
      content: '',
      tags: [
        ['order', 'purchase'],
        ...(type === 'receipt' ? [['subject', 'order-receipt']] : [['type', type]]),
      ],
    };
    const original = {
      owner,
      sender: owner,
      fromMe: true,
      conversation: 'seller',
      content: serializeOrder(
        parseOrderEvent({
          kind: 16,
          content: '',
          tags: [
            ['type', '1'],
            ['order', 'purchase'],
          ],
        })!,
      ),
    };
    (getOutgoingOrderRows as jest.Mock).mockResolvedValue([]);
    expect(await admitOrderLifecycle(owner, 'seller', false, rumor)).toBe(false);
    expect(getDroppedOrderLifecycleCount(owner)).toBe(1);
    (getOutgoingOrderRows as jest.Mock).mockResolvedValue([original]);
    expect(await admitOrderLifecycle(owner, 'impostor', false, rumor)).toBe(false);
    expect(
      await admitOrderLifecycle(owner, 'seller', false, {
        ...rumor,
        tags: [['order', 'different'], ...rumor.tags.slice(1)],
      }),
    ).toBe(false);
    expect(await admitOrderLifecycle(owner, 'seller', false, rumor)).toBe(true);
    expect(getOutgoingOrderRows).toHaveBeenLastCalledWith(owner, 'seller', ['purchase']);
    expect(getDroppedOrderLifecycleCount(owner)).toBe(3);
    (getOutgoingOrderRows as jest.Mock).mockResolvedValue([
      {
        ...original,
        content: serializeOrder(
          parseOrderEvent({
            kind: 16,
            content: '',
            tags: [
              ['type', '2'],
              ['order', 'purchase'],
            ],
          })!,
        ),
      },
    ]);
    expect(await admitOrderLifecycle(owner, 'seller', false, rumor)).toBe(false);
  },
);

it('binds seller receipts to the invoiced buyer without admitting their merchant updates', async () => {
  const owner = 'seller-role';
  const partner = 'e'.repeat(64);
  const rumor = {
    kind: 17,
    content: '',
    tags: [
      ['subject', 'order-receipt'],
      ['order', 'sold-order'],
    ],
  };
  (getOutgoingOrderRows as jest.Mock).mockResolvedValue([]);
  await recordSellerInvoice(owner, {
    orderId: 'sold-order',
    buyerPubkey: partner,
    walletId: 'wallet',
    paymentHash: '0'.repeat(64),
    bolt11: 'lnbc1',
    amountSats: 21,
    sentAt: 1,
  });
  expect(await admitOrderLifecycle(owner, partner, false, rumor)).toBe(true);
  expect(await admitOrderLifecycle(owner, 'impostor', false, rumor)).toBe(false);
  expect(
    await admitOrderLifecycle(owner, partner, false, {
      ...rumor,
      kind: 16,
      tags: [
        ['type', '2'],
        ['order', 'sold-order'],
      ],
    }),
  ).toBe(false);
});
