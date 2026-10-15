import type { Event as NostrEvent } from 'nostr-tools';

import { createMemoryMarmotBackend } from './marmotStore';
import {
  KEY_PACKAGE_HISTORY_SECS,
  keyPackageRelayHistory,
  rememberKeyPackageRelays,
} from './marmotKeyPackageHistory';

jest.mock('@internet-privacy/marmot-ts', () => ({
  ...jest.requireActual('@internet-privacy/marmot-ts'),
  getKeyPackageLifetime: (event: NostrEvent) =>
    event.content
      ? { notBefore: BigInt(event.created_at), notAfter: BigInt(event.content) }
      : undefined,
}));

const now = 1_800_000_000;
const event = (id: string, expires: number) =>
  ({
    id,
    created_at: now,
    content: String(expires),
  }) as NostrEvent;

beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(now * 1000));
afterEach(() => jest.restoreAllMocks());

it('expires obsolete copies while retaining destinations of a newer copied key', async () => {
  const backend = createMemoryMarmotBackend();
  await rememberKeyPackageRelays(
    backend,
    ['wss://old.example', 'wss://shared.example'],
    event('a', now + 100),
  );
  await rememberKeyPackageRelays(
    backend,
    ['wss://new.example', 'wss://shared.example'],
    event('b', now + 500),
  );
  jest.spyOn(Date, 'now').mockReturnValue((now + 4000) * 1000);
  expect(await keyPackageRelayHistory(backend)).toEqual({
    'wss://new.example': now + 4100,
    'wss://shared.example': now + 4100,
  });
  jest.spyOn(Date, 'now').mockReturnValue((now + 5000) * 1000);
  expect(await keyPackageRelayHistory(backend)).toEqual({});
});

it('migrates legacy relay arrays once without renewing their deadline on reads', async () => {
  const backend = createMemoryMarmotBackend();
  await backend.set('keyPackageDiscovery', 'relays', JSON.stringify(['wss://legacy.example']));
  expect(await keyPackageRelayHistory(backend)).toEqual({
    'wss://legacy.example': now + KEY_PACKAGE_HISTORY_SECS,
  });
  expect(await backend.get('keyPackageDiscovery', 'relays')).toBeNull();
  jest.spyOn(Date, 'now').mockReturnValue((now + KEY_PACKAGE_HISTORY_SECS + 1) * 1000);
  expect(await keyPackageRelayHistory(backend)).toEqual({});
});

it('expires undecodable legacy keys by publication age rather than extending each retry', async () => {
  const backend = createMemoryMarmotBackend();
  const old = { id: 'old', created_at: now, content: '' } as NostrEvent;
  await rememberKeyPackageRelays(backend, ['wss://old.example'], old);
  jest.spyOn(Date, 'now').mockReturnValue((now + KEY_PACKAGE_HISTORY_SECS + 1) * 1000);
  await rememberKeyPackageRelays(backend, ['wss://old.example'], old);
  expect(await keyPackageRelayHistory(backend)).toEqual({});
});
