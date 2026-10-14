import {
  composeDeliveryAddress,
  emptyDeliveryAddress,
  parseDeliveryAddress,
  validPostcode,
} from './deliveryAddress';
import { buildMarketOrder } from './marketOrder';
import { parseOrderEvent } from './orderEvents';
const fields = {
  name: 'Buyer',
  line1: '1 High St',
  line2: 'Flat 2',
  town: 'London',
  postcode: 'SW1A 1AA',
};
it('round-trips one Gamma address tag and accepts old single-line orders', () => {
  const address = composeDeliveryAddress(fields, 'GB')!;
  const { rumor } = buildMarketOrder({
    buyerPubkey: 'a'.repeat(64),
    vendorPubkey: 'b'.repeat(64),
    lines: [],
    address,
  });
  expect(rumor.tags.filter((tag) => tag[0] === 'address')).toEqual([['address', address]]);
  expect(parseDeliveryAddress(rumor.tags.find((tag) => tag[0] === 'address')![1])).toEqual([
    ...Object.values(fields),
    'GB',
  ]);
  expect(parseOrderEvent(rumor)?.type).toBe('order');
  expect(
    parseOrderEvent({
      ...rumor,
      tags: rumor.tags.map((tag) =>
        tag[0] === 'address' ? ['address', '1 High St, London'] : tag,
      ),
    })?.type,
  ).toBe('order');
  expect(parseDeliveryAddress('1 High St, London')).toEqual(['1 High St, London']);
});
it('blocks missing required fields and never truncates the complete address', () => {
  expect(composeDeliveryAddress(emptyDeliveryAddress(), 'GB')).toBeNull();
  for (const key of ['name', 'line1', 'town', 'postcode'] as const)
    expect(composeDeliveryAddress({ ...fields, [key]: '' }, 'GB')).toBeNull();
  expect(composeDeliveryAddress(fields, '')).toBeNull();
  const withoutName = composeDeliveryAddress({ ...fields, name: 'a' }, 'GB')!.length - 1;
  expect(
    composeDeliveryAddress({ ...fields, name: 'a'.repeat(500 - withoutName) }, 'GB')?.length,
  ).toBe(500);
  expect(
    composeDeliveryAddress({ ...fields, name: 'a'.repeat(501 - withoutName) }, 'GB'),
  ).toBeNull();
  expect(composeDeliveryAddress({ ...fields, line2: '' }, 'GB')).toBe(
    'Buyer\n1 High St\nLondon\nSW1A 1AA\nGB',
  );
});
it.each([
  ['GB', 'SW1A 1AA', true],
  ['GB', 'sw1a1aa', true],
  ['GB', 'GIR 0AA', true],
  ['GB', 'invalid', false],
  ['US', '90210', true],
  ['US', '90210-1234', true],
  ['US', '9021', false],
  ['DE', '10115', true],
  ['DE', 'D-10115', false],
  ['IE', 'Free text', true],
  ['IE', ' ', false],
])('validates %s postcode %s', (country, postcode, expected) => {
  expect(validPostcode(postcode, country)).toBe(expected);
});
