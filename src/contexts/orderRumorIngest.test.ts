import {
  admitUnfollowedOrder,
  isBoundedOrderRumor,
  ORDER_RUMOR_RATE_LIMIT,
  ORDER_RUMOR_MAX_CHARS,
} from './orderRumorIngest';

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
