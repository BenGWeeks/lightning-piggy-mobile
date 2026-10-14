import {
  isFollowUpForOwnOrder,
  mightBeOwnListingOrder,
  orderLinesSummary,
  ownListingOrderLines,
} from './sellerOrderSignal';
import { parseOrderEvent } from './orderEvents';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const rumor = (items: string[][]) => ({
  kind: 16,
  content: '',
  tags: [['type', '1'], ['order', 'o-1'], ...items.map((i) => ['item', ...i])],
});
const index = new Map([
  [`30402:${ME}:mug`, 'Mug'],
  [`30402:${ME}:hat`, 'Hat'],
]);

it('pre-check: a type-1 order naming at least one of my listings', () => {
  expect(mightBeOwnListingOrder(rumor([[`30402:${ME}:mug`, '1']]), ME)).toBe(true);
  expect(mightBeOwnListingOrder(rumor([[`30402:${OTHER}:mug`, '1']]), ME)).toBe(false);
  expect(mightBeOwnListingOrder({ ...rumor([[`30402:${ME}:mug`]]), kind: 17 }, ME)).toBe(false);
});

it('lines only when EVERY item is one of my current listings', () => {
  const mine = parseOrderEvent(
    rumor([
      [`30402:${ME}:mug`, '2'],
      [`30402:${ME}:hat`, '1'],
    ]),
  )!;
  expect(ownListingOrderLines(mine, ME, index)).toEqual([
    { title: 'Mug', quantity: 2 },
    { title: 'Hat', quantity: 1 },
  ]);
  const mixed = parseOrderEvent(
    rumor([
      [`30402:${ME}:mug`, '1'],
      [`30402:${OTHER}:x`, '1'],
    ]),
  )!;
  expect(ownListingOrderLines(mixed, ME, index)).toBeNull();
  const gone = parseOrderEvent(rumor([[`30402:${ME}:gone`, '1']]))!;
  expect(ownListingOrderLines(gone, ME, index)).toBeNull();
});

it('follow-ups pass only for orders I invoiced', () => {
  const receipt = parseOrderEvent({
    kind: 17,
    content: '',
    tags: [
      ['subject', 'order-receipt'],
      ['order', 'o-1'],
      ['payment', 'lightning', 'x', 'y'],
    ],
  })!;
  expect(isFollowUpForOwnOrder(receipt, new Set(['o-1']))).toBe(true);
  expect(isFollowUpForOwnOrder(receipt, new Set(['o-2']))).toBe(false);
});

it('summarises lines for the notification', () => {
  expect(orderLinesSummary([{ title: 'Mug', quantity: 2 }])).toBe('Mug × 2');
  expect(orderLinesSummary(['A', 'B', 'C', 'D'].map((title) => ({ title, quantity: 1 })))).toBe(
    'A × 1, B × 1, C × 1, …',
  );
});
