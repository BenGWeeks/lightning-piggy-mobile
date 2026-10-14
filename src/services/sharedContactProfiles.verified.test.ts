import { finalizeEvent, type Event } from 'nostr-tools/pure';
import { resolveSharedContactProfiles } from './sharedContactProfiles';
import { pool } from './nostrPool';
import { __resetVerifiedEventCache } from './nostrVerifyCache';
import * as cache from './zapSenderProfileStorage';

jest.mock('./zapSenderProfileStorage', () => ({ getMany: jest.fn() }));
const getMany = jest.mocked(cache.getMany);
const signed = finalizeEvent(
  {
    kind: 0,
    tags: [],
    created_at: 1,
    content: JSON.stringify({ name: 'Piggy', lud16: 'piggy@example.com' }),
  },
  new Uint8Array(32).fill(7),
);

beforeEach(() => {
  jest.useFakeTimers();
  __resetVerifiedEventCache();
  getMany.mockResolvedValue(new Map());
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function captureEvents() {
  let emit!: (event: Event) => void;
  const close = jest.fn();
  jest.spyOn(pool, 'subscribeManyEose').mockImplementation((_relays, _filter, handlers) => {
    emit = handlers.onevent!;
    return { close };
  });
  return { emit: (event: Event) => emit(event), close };
}

it.each([false, true])('retains a verified Zap address (display cache hit: %s)', async (cached) => {
  if (cached)
    getMany.mockResolvedValue(
      new Map([
        [
          signed.pubkey,
          {
            npub: 'cached',
            name: 'Cached Piggy',
            displayName: null,
            nip05: null,
            picture: null,
          },
        ],
      ]),
    );
  const relay = captureEvents();
  const pending = resolveSharedContactProfiles([{ pubkey: signed.pubkey, relays: [] }]);
  await jest.advanceTimersByTimeAsync(0);
  // A forged newer event must neither supply an address nor close the batch.
  relay.emit(
    JSON.parse(
      JSON.stringify({ ...signed, created_at: 2, content: '{"lud16":"attacker@example.com"}' }),
    ),
  );
  expect(relay.close).not.toHaveBeenCalled();
  relay.emit(JSON.parse(JSON.stringify(signed)));
  expect((await pending)[signed.pubkey]?.lud16).toBe('piggy@example.com');
  expect(relay.close).toHaveBeenCalledTimes(1);
});

it('never exposes an unverified payment address when only a forgery arrives', async () => {
  const relay = captureEvents();
  const pending = resolveSharedContactProfiles([{ pubkey: signed.pubkey, relays: [] }]);
  await jest.advanceTimersByTimeAsync(0);
  relay.emit(JSON.parse(JSON.stringify({ ...signed, sig: '0'.repeat(128) })));
  await jest.advanceTimersByTimeAsync(10000);
  expect(await pending).toEqual({ [signed.pubkey]: null });
});
