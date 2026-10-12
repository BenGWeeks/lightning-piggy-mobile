import type { Event } from 'nostr-tools';
import { removeWithdrawnShippingReferences } from './marketShippingWithdrawal';

const removed = '30406:author:gone';
const retained = ['shipping_option', '30406:other:kept', '2.5'];
const listing = {
  kind: 30402,
  created_at: 100,
  content: 'Description',
  tags: [['d', 'book'], ['type', 'physical'], ['shipping_option', removed, '1'], retained],
} as Event;

test('republishes affected current listings without withdrawn references, preserving other fields', async () => {
  const current = {
    ...listing,
    content: 'Edited elsewhere',
    created_at: 200,
    tags: [...listing.tags, ['unknown', 'preserve']],
  };
  const latest = jest.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(null);
  const publish = jest.fn().mockResolvedValue({});
  await removeWithdrawnShippingReferences({
    coordinates: new Set([removed]),
    listings: [listing, { ...listing, tags: [retained] }],
    latest,
    publish,
  });
  expect(latest).toHaveBeenCalledTimes(2);
  expect(publish).toHaveBeenCalledWith(
    {
      kind: 30402,
      content: 'Edited elsewhere',
      tags: [['d', 'book'], ['type', 'physical'], retained, ['unknown', 'preserve']],
    },
    current,
  );
});

test('skips deleted listings and references already removed from the current revision', async () => {
  const latest = jest
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ ...listing, tags: [retained] });
  const publish = jest.fn();
  await removeWithdrawnShippingReferences({
    coordinates: new Set([removed]),
    listings: [listing, listing],
    latest,
    publish,
  });
  expect(publish).not.toHaveBeenCalled();
});

test('propagates a latest-revision failure without overwriting the cached listing', async () => {
  const publish = jest.fn();
  await expect(
    removeWithdrawnShippingReferences({
      coordinates: new Set([removed]),
      listings: [listing],
      latest: jest.fn().mockRejectedValue(new Error('timeout')),
      publish,
    }),
  ).rejects.toThrow('timeout');
  expect(publish).not.toHaveBeenCalled();
});

test('removes references added on another device after the snapshot loaded', async () => {
  const cached = { ...listing, tags: [['d', 'book'], ['type', 'physical'], retained] };
  const current = { ...listing, created_at: 200 };
  const latest = jest.fn().mockResolvedValue(current);
  const publish = jest.fn().mockResolvedValue({});
  await removeWithdrawnShippingReferences({
    coordinates: new Set([removed]),
    listings: [cached],
    latest,
    publish,
  });
  expect(latest).toHaveBeenCalledWith(cached);
  expect(publish).toHaveBeenCalledWith(
    { kind: listing.kind, content: listing.content, tags: cached.tags },
    current,
  );
});
