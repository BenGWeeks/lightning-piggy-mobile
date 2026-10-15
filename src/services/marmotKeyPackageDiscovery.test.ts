import type { MarmotClient } from '@internet-privacy/marmot-ts';
import type { Event as NostrEvent, EventTemplate, Filter } from 'nostr-tools';
import { TEST_ACCOUNT_PUBKEYS, TEST_RELAY_URL } from '../config/testRelayLockdown';
import { fetchKeyPackageEvents } from './marmotInvitees';
import { maintainKeyPackage } from './marmotKeyPackageLifecycle';
import { maintainDiscoverableKeyPackage } from './marmotKeyPackageDiscovery';
import { MARMOT_KEY_PACKAGE_RELAYS } from './marmotKeyPackageRelays';
import { createMemoryMarmotBackend } from './marmotStore';

jest.mock('./marmotKeyPackageLifecycle', () => ({
  maintainKeyPackage: jest.fn(async () => 'unchanged'),
  currentKeyPackage: (list: unknown[]) => list[0],
}));

const owner = 'a'.repeat(64);
const event = {
  id: 'key',
  kind: 30443,
  created_at: 1,
  pubkey: owner,
  tags: [],
  content: 'key',
  sig: '',
} as NostrEvent;
function setup() {
  const backend = createMemoryMarmotBackend();
  const publish = jest.fn(async (relays: string[], _event: NostrEvent) =>
    Object.fromEntries(relays.map((r) => [r, { from: r, ok: true }])),
  );
  const signEvent = jest.fn(async (draft: EventTemplate) => ({
    ...draft,
    id: 'list',
    pubkey: owner,
    sig: '',
  }));
  const client = {
    keyPackages: { list: async () => [{ published: [event] }] },
    network: { publish },
    signer: { signEvent },
  } as unknown as Pick<MarmotClient, 'keyPackages' | 'network' | 'signer'>;
  const opts = {
    relays: ['wss://own.example'],
    slot: 'slot',
    client: 'test',
    isUpToDate: () => true,
    acceptedRelays: () => ['wss://own.example', ...MARMOT_KEY_PACKAGE_RELAYS],
  };
  return { backend, client, publish, signEvent, opts };
}
beforeEach(() => jest.mocked(maintainKeyPackage).mockResolvedValue('unchanged'));
it('migrates an existing key, advertises 10051 on indexers, and does no writes on relaunch', async () => {
  const t = setup();
  await maintainDiscoverableKeyPackage(t.client, t.backend, owner, t.opts);
  expect(t.publish).toHaveBeenCalledTimes(2);
  expect(t.publish.mock.calls[0][0]).toEqual(['wss://own.example', ...MARMOT_KEY_PACKAGE_RELAYS]);
  expect(t.publish.mock.calls[0][1]).toBe(event);
  expect(t.publish.mock.calls[1][0]).toContain('wss://purplepag.es');
  expect(t.publish.mock.calls[1][1].kind).toBe(10051);
  await maintainDiscoverableKeyPackage(t.client, t.backend, owner, t.opts);
  expect(t.publish).toHaveBeenCalledTimes(2);
  expect(t.signEvent).toHaveBeenCalledTimes(1);
  await maintainDiscoverableKeyPackage(t.client, t.backend, owner, {
    ...t.opts,
    relays: ['wss://changed.example'],
  });
  expect(t.publish).toHaveBeenCalledTimes(4);
  expect(t.signEvent).toHaveBeenCalledTimes(2);
});
it('does not duplicate a newly published key and does not publish a list after key failure', async () => {
  const t = setup();
  jest.mocked(maintainKeyPackage).mockResolvedValueOnce('failed');
  await expect(maintainDiscoverableKeyPackage(t.client, t.backend, owner, t.opts)).resolves.toBe(
    'failed',
  );
  expect(t.publish).not.toHaveBeenCalled();
  jest.mocked(maintainKeyPackage).mockResolvedValueOnce('published');
  await maintainDiscoverableKeyPackage(t.client, t.backend, owner, t.opts);
  expect(t.publish).toHaveBeenCalledTimes(1);
  expect(t.publish.mock.calls[0][1].kind).toBe(10051);
});
it('retries a rejected list without republishing the accepted key', async () => {
  const t = setup();
  t.publish
    .mockImplementationOnce(async (relays) =>
      Object.fromEntries(relays.map((r) => [r, { from: r, ok: true }])),
    )
    .mockImplementationOnce(async () => ({ relay: { from: 'relay', ok: false } }));
  await expect(maintainDiscoverableKeyPackage(t.client, t.backend, owner, t.opts)).rejects.toThrow(
    'not accepted',
  );
  expect(await t.backend.get('keyPackageDiscovery', 'failed')).toBe('true');
  await maintainDiscoverableKeyPackage(t.client, t.backend, owner, t.opts);
  expect(t.publish.mock.calls.map((c) => c[1].kind)).toEqual([30443, 10051, 10051]);
  expect(t.signEvent).toHaveBeenCalledTimes(1);
  expect(await t.backend.get('keyPackageDiscovery', 'failed')).toBe('false');
});
it('never signs or publishes discovery after cancellation', async () => {
  const t = setup();
  await maintainDiscoverableKeyPackage(t.client, t.backend, owner, {
    ...t.opts,
    cancelled: () => true,
  });
  expect(t.publish).not.toHaveBeenCalled();
  expect(t.signEvent).not.toHaveBeenCalled();
});
it('publishes both the key and list to LAN only for locked owners', async () => {
  const t = setup();
  await maintainDiscoverableKeyPackage(t.client, t.backend, [...TEST_ACCOUNT_PUBKEYS][0], t.opts);
  expect(
    t.publish.mock.calls.every((c) => JSON.stringify(c[0]) === JSON.stringify([TEST_RELAY_URL])),
  ).toBe(true);
  expect(t.signEvent.mock.calls[0][0].tags).toEqual([['relay', TEST_RELAY_URL]]);
});
it('reads newest peer 10051 first, then NIP-65 write relays, then well-known relays, bounded', async () => {
  const lists = [
    { ...event, kind: 10051, id: 'old', created_at: 1, tags: [['relay', 'wss://stale.example']] },
    { ...event, kind: 10051, id: 'new', created_at: 2, tags: [['relay', 'wss://key.example']] },
    {
      ...event,
      kind: 10002,
      tags: [
        ['r', 'wss://write.example', 'write'],
        ['r', 'wss://read.example', 'read'],
      ],
    },
  ];
  const request = jest.fn(async (_relays: string[], filter: Filter | Filter[]) =>
    Array.isArray(filter) ? lists : [event],
  );
  expect(await fetchKeyPackageEvents({ request }, ['wss://lookup.example'], owner)).toEqual([
    event,
  ]);
  expect(request.mock.calls[0][0]).toContain('wss://purplepag.es');
  expect(request.mock.calls[0][1]).toEqual([
    { kinds: [10051], authors: [owner], limit: 1 },
    { kinds: [10002], authors: [owner], limit: 1 },
  ]);
  expect(request.mock.calls[1][0]).toEqual([
    'wss://key.example',
    'wss://write.example',
    ...MARMOT_KEY_PACKAGE_RELAYS,
    'wss://lookup.example',
  ]);
  expect(request.mock.calls[1][1]).toEqual({ kinds: [30443], authors: [owner], limit: 50 });
});

it('retains well-known destinations even when peer relay lists are oversized', async () => {
  const many = (prefix: string) =>
    Array.from({ length: 100 }, (_, i) => `wss://${prefix}${i}.example`);
  const request = jest.fn(async (_relays: string[], filters: Filter | Filter[]) =>
    Array.isArray(filters)
      ? [
          { ...event, kind: 10051, tags: many('key').map((r) => ['relay', r]) },
          { ...event, kind: 10002, tags: many('write').map((r) => ['r', r]) },
        ]
      : [],
  );
  await fetchKeyPackageEvents({ request }, many('lookup'), owner);
  expect(request.mock.calls[0][0].length).toBeLessThanOrEqual(12);
  expect(request.mock.calls[0][0]).toEqual(
    expect.arrayContaining(['wss://purplepag.es', 'wss://user.kindpag.es']),
  );
  expect(request.mock.calls[1][0]).toHaveLength(27);
  expect(request.mock.calls[1][0]).toEqual(expect.arrayContaining(MARMOT_KEY_PACKAGE_RELAYS));
});
it('checks cancellation after storage waits before asking a signer', async () => {
  const t = setup();
  let stopped = false;
  const get = t.backend.get;
  t.backend.get = async (namespace, key) => {
    const result = await get(namespace, key);
    if (key === 'timestamp') stopped = true;
    return result;
  };
  await expect(
    maintainDiscoverableKeyPackage(t.client, t.backend, owner, {
      ...t.opts,
      cancelled: () => stopped,
    }),
  ).rejects.toThrow('cancelled');
  expect(t.signEvent).not.toHaveBeenCalled();
});

it('advertises accepted keys while retaining partial receipts for later retries', async () => {
  const t = setup();
  let recovered = false;
  t.publish.mockImplementation(async (relays) =>
    Object.fromEntries(
      relays.map((r) => [r, { from: r, ok: !r.includes('us.whitenoise') || recovered }]),
    ),
  );
  await expect(maintainDiscoverableKeyPackage(t.client, t.backend, owner, t.opts)).resolves.toBe(
    'failed',
  );
  expect(t.publish.mock.calls.map((c) => c[1].kind)).toEqual([30443, 10051]);
  expect(await t.backend.get('keyPackageDiscovery', 'list')).toBeNull();
  recovered = true;
  await expect(maintainDiscoverableKeyPackage(t.client, t.backend, owner, t.opts)).resolves.toBe(
    'unchanged',
  );
  expect(t.publish.mock.calls.slice(2).map((c) => c[0])).toEqual([
    ['wss://relay.us.whitenoise.chat'],
    ['wss://relay.us.whitenoise.chat'],
  ]);
  expect(t.signEvent).toHaveBeenCalledTimes(1);
  await maintainDiscoverableKeyPackage(t.client, t.backend, owner, t.opts);
  expect(t.publish).toHaveBeenCalledTimes(4);
});
