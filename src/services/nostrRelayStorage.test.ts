/**
 * Unit tests for the user-relay storage helpers + merge/validation
 * logic that backs the in-app relay editor (#202). The merge is the
 * load-bearing piece here — the rest of the app reads `NostrContext.relays`
 * and filters by `read`/`write`, so the merge result has to dedupe
 * correctly across (defaults, NIP-65, user overrides) and respect
 * user precedence on conflicts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUserRelays, setUserRelays, validateRelayUrl, mergeRelays } from './nostrRelayStorage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('validateRelayUrl', () => {
  it('accepts a well-formed wss:// URL', () => {
    const r = validateRelayUrl('wss://relay.example.com');
    expect(r).toEqual({ ok: true, url: 'wss://relay.example.com' });
  });

  it('strips trailing slash for canonical comparison', () => {
    const r = validateRelayUrl('wss://relay.example.com/');
    expect(r).toEqual({ ok: true, url: 'wss://relay.example.com' });
  });

  it('trims surrounding whitespace', () => {
    const r = validateRelayUrl('  wss://relay.example.com  ');
    expect(r).toEqual({ ok: true, url: 'wss://relay.example.com' });
  });

  it('accepts ws://localhost for local dev', () => {
    const r = validateRelayUrl('ws://localhost:7000');
    expect(r.ok).toBe(true);
  });

  it('accepts ws://10.0.2.2 (Android emulator host loopback)', () => {
    const r = validateRelayUrl('ws://10.0.2.2:7000');
    expect(r.ok).toBe(true);
  });

  it('rejects ws:// for non-local hosts', () => {
    const r = validateRelayUrl('ws://relay.example.com');
    expect(r.ok).toBe(false);
  });

  it('rejects https:// (wrong protocol)', () => {
    const r = validateRelayUrl('https://relay.example.com');
    expect(r.ok).toBe(false);
  });

  it('rejects an empty string', () => {
    const r = validateRelayUrl('   ');
    expect(r.ok).toBe(false);
  });

  it('rejects garbage that is not a URL', () => {
    const r = validateRelayUrl('not a url');
    expect(r.ok).toBe(false);
  });
});

describe('getUserRelays / setUserRelays', () => {
  it('returns [] when nothing is persisted', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce(null);
    const r = await getUserRelays();
    expect(r).toEqual([]);
  });

  it('round-trips a saved list through AsyncStorage', async () => {
    const list = [{ url: 'wss://r.example', read: true, write: false }];
    await setUserRelays(list);
    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith('user_relays_v1', JSON.stringify(list));
    mockedAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(list));
    const r = await getUserRelays();
    expect(r).toEqual(list);
  });

  it('returns [] when the persisted JSON is malformed', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce('{not json');
    const r = await getUserRelays();
    expect(r).toEqual([]);
  });

  it('filters out entries that do not match the RelayConfig shape', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce(
      JSON.stringify([
        { url: 'wss://ok.example', read: true, write: true },
        { url: 'wss://no-flags.example' }, // missing read/write
        'a string',
      ]),
    );
    const r = await getUserRelays();
    expect(r).toEqual([{ url: 'wss://ok.example', read: true, write: true }]);
  });
});

describe('mergeRelays', () => {
  const defaults = ['wss://default-a', 'wss://default-b'];

  it('returns defaults (read+write) when no overrides exist', () => {
    const r = mergeRelays({ nip65: [], user: [], defaults });
    expect(r).toEqual([
      { url: 'wss://default-a', read: true, write: true },
      { url: 'wss://default-b', read: true, write: true },
    ]);
  });

  it('appends user-only relays after defaults', () => {
    const r = mergeRelays({
      nip65: [],
      user: [{ url: 'wss://user-x', read: true, write: false }],
      defaults,
    });
    expect(r).toContainEqual({ url: 'wss://user-x', read: true, write: false });
    expect(r).toHaveLength(3);
  });

  it('lets user flags override NIP-65 flags on the same URL', () => {
    const r = mergeRelays({
      nip65: [{ url: 'wss://shared', read: true, write: true }],
      user: [{ url: 'wss://shared', read: true, write: false }],
      defaults: [],
    });
    expect(r).toEqual([{ url: 'wss://shared', read: true, write: false }]);
  });

  it('lets NIP-65 flags override default flags', () => {
    // A default URL shows up in NIP-65 with read-only; result reflects NIP-65.
    const r = mergeRelays({
      nip65: [{ url: 'wss://default-a', read: true, write: false }],
      user: [],
      defaults,
    });
    const a = r.find((x) => x.url === 'wss://default-a');
    expect(a).toEqual({ url: 'wss://default-a', read: true, write: false });
  });

  it('dedupes across all three sources', () => {
    const r = mergeRelays({
      nip65: [{ url: 'wss://default-a', read: true, write: true }],
      user: [{ url: 'wss://default-a', read: true, write: true }],
      defaults,
    });
    const matches = r.filter((x) => x.url === 'wss://default-a');
    expect(matches).toHaveLength(1);
  });
});
