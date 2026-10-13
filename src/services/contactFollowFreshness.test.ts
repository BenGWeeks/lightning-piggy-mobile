import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  adoptFollowSnapshot,
  newestFollowSnapshot,
  readFollowSnapshot,
} from './contactFollowFreshness';
import { createLiveSubFollowGateBuffer } from '../contexts/liveSubFollowGate';
import { buildFollowSet } from '../utils/followPubkeys';

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { fetchContactList, pool } from './nostrService';

const LITTLE = 'd9b33280' + 'a'.repeat(56);

describe('follow hydration (#1458)', () => {
  it.each(['slow.example', 'purplepag.es'])(
    'waits for the newer kind-3 on %s instead of freezing the first list',
    async (newestRelay) => {
      jest.useFakeTimers();
      const sk = generateSecretKey();
      const older = finalizeEvent({ kind: 3, created_at: 100, tags: [], content: '' }, sk);
      const newer = finalizeEvent(
        { kind: 3, created_at: 200, tags: [['p', LITTLE]], content: '' },
        sk,
      );
      const close = jest.fn();
      const aggregate = jest
        .spyOn(pool, 'subscribeMany')
        .mockImplementation((_urls, _filter, handlers) => {
          setTimeout(() => handlers!.onevent!(older), 1);
          setTimeout(() => handlers!.onevent!(newer), 50);
          return { close } as ReturnType<typeof pool.subscribeMany>;
        });
      const connect = jest.spyOn(pool, 'ensureRelay').mockImplementation(
        async (url) =>
          ({
            subscribe: (
              _filters: unknown,
              handlers: { onevent: (event: typeof older) => void; oneose: () => void },
            ) => {
              setTimeout(
                () => {
                  handlers.onevent(url.includes(newestRelay) ? newer : older);
                  handlers.oneose();
                },
                url.includes(newestRelay) ? 50 : 1,
              );
              return { close };
            },
          }) as unknown as Awaited<ReturnType<typeof pool.ensureRelay>>,
      );
      const result = fetchContactList(getPublicKey(sk), [
        'wss://fast.example',
        'wss://slow.example',
      ]);
      await jest.advanceTimersByTimeAsync(60);
      expect((await result)?.map((c) => c.pubkey)).toEqual([LITTLE]);
      expect(connect.mock.calls.map(([url]) => url)).toContain('wss://purplepag.es/');
      jest.runOnlyPendingTimers();
      aggregate.mockRestore();
      connect.mockRestore();
      jest.useRealTimers();
    },
  );
});

it('keeps the newest kind-3 across restarts and concurrent older refreshes (#1458)', async () => {
  await AsyncStorage.clear();
  const newer = {
    contacts: [{ pubkey: LITTLE, relay: null, petname: null, profile: null }],
    createdAt: 200,
    id: 'a',
  };
  await adoptFollowSnapshot('owner', newer);
  expect(await readFollowSnapshot('owner')).toEqual(newer);
  const older = { contacts: [], createdAt: 100, id: 'b' };
  expect(await adoptFollowSnapshot('owner', older)).toEqual(newer);
  const results = await Promise.all([
    adoptFollowSnapshot('owner', newer),
    adoptFollowSnapshot('owner', older),
  ]);
  expect(results).toEqual([newer, newer]);
  expect(newestFollowSnapshot(newer, { ...older, createdAt: 200 })).toEqual(newer);
});

it('replays a gated wrap exactly once when the refreshed follow list hydrates (#1458)', async () => {
  await AsyncStorage.clear();
  const buffer = createLiveSubFollowGateBuffer();
  buffer.defer({
    partnerPubkey: LITTLE.toUpperCase(),
    entry: {
      id: 'wrap',
      partnerPubkey: LITTLE,
      fromMe: false,
      createdAt: 200,
      text: 'hello',
      wireKind: 14,
    },
  });
  const replay = jest.fn();
  const hydrate = (contacts: { pubkey: string }[]) =>
    buffer.reevaluate(buildFollowSet(contacts.map((c) => c.pubkey)), replay);
  await adoptFollowSnapshot('owner', { contacts: [], createdAt: 100 }, hydrate);
  expect(replay).not.toHaveBeenCalled();
  const newer = {
    contacts: [{ pubkey: LITTLE, relay: null, petname: null, profile: null }],
    createdAt: 200,
  };
  await adoptFollowSnapshot('owner', newer, hydrate);
  await adoptFollowSnapshot('owner', newer, hydrate);
  expect(replay).toHaveBeenCalledTimes(1);
  expect(buffer.size).toBe(0);
});
