/**
 * Coverage for the AsyncStorage-backed cache of resolved Nostr
 * counterparties for outgoing zaps. The store is a key/value JSON blob
 * — we mock AsyncStorage with the package's official jest mock so the
 * tests exercise the real serialise/deserialise + LRU eviction code
 * paths, just against an in-memory map.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetForTests,
  getByPaymentHash,
  getMany,
  getWriteVersion,
  recordOutgoing,
} from './zapCounterpartyStorage';
import type { ZapCounterpartyInfo } from '../types/wallet';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run before ESM imports are hoisted; require is the canonical form.
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function info(pubkey: string, comment = ''): ZapCounterpartyInfo {
  return {
    pubkey,
    profile: null,
    comment,
    anonymous: false,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetForTests();
});

describe('recordOutgoing + getByPaymentHash', () => {
  it('round-trips a record through storage', async () => {
    await recordOutgoing('hash1', info('pkA'));
    expect(await getByPaymentHash('hash1')).toEqual(info('pkA'));
  });

  it('overwrites an existing entry on re-record (last write wins)', async () => {
    await recordOutgoing('hash1', info('pkA', 'first'));
    await recordOutgoing('hash1', info('pkA', 'second'));
    const got = await getByPaymentHash('hash1');
    expect(got?.comment).toBe('second');
  });

  it('no-ops on an empty paymentHash', async () => {
    const before = getWriteVersion();
    await recordOutgoing('', info('pkA'));
    expect(getWriteVersion()).toBe(before);
    expect(await getByPaymentHash('')).toBeNull();
  });

  it('returns null on a miss', async () => {
    expect(await getByPaymentHash('never-recorded')).toBeNull();
  });

  it('bumps the write version on every successful record', async () => {
    const start = getWriteVersion();
    await recordOutgoing('h1', info('a'));
    const afterFirst = getWriteVersion();
    expect(afterFirst).toBe(start + 1);
    await recordOutgoing('h2', info('b'));
    expect(getWriteVersion()).toBe(afterFirst + 1);
  });
});

describe('getMany', () => {
  it('returns an empty map when given no hashes', async () => {
    const out = await getMany([]);
    expect(out.size).toBe(0);
  });

  it('returns only hits, omitting unknown hashes', async () => {
    await recordOutgoing('h1', info('a'));
    await recordOutgoing('h2', info('b'));
    const out = await getMany(['h1', 'h2', 'missing']);
    expect(out.size).toBe(2);
    expect(out.get('h1')).toEqual(info('a'));
    expect(out.get('h2')).toEqual(info('b'));
    expect(out.has('missing')).toBe(false);
  });
});

describe('LRU eviction', () => {
  // The cap is 500 entries internally — exercise the eviction path with
  // a smaller-but-still-meaningful number to avoid a 500-await loop in
  // the test body. The eviction check fires whenever Object.keys.length
  // exceeds MAX_ENTRIES (500), so we manually pre-seed storage with the
  // 500 cap pre-loaded then push one more.
  it('drops the oldest entries when the cap is exceeded', async () => {
    // Pre-seed 500 entries via direct AsyncStorage write to skip 500
    // sequential awaits. Each entry's savedAt counts upward so the
    // sort-by-savedAt eviction picks the lowest savedAt as oldest.
    const seeded: Record<string, { info: ZapCounterpartyInfo; savedAt: number }> = {};
    for (let i = 0; i < 500; i++) {
      seeded[`old${i}`] = { info: info(`old${i}`), savedAt: 1000 + i };
    }
    await AsyncStorage.setItem('zap_counterparties_v1', JSON.stringify(seeded));
    // Force the in-memory cache to repopulate from the seeded blob.
    __resetForTests();

    // Now write one more — total 501 → triggers the >MAX_ENTRIES branch
    // and the oldest (savedAt = 1000, "old0") should be evicted.
    await recordOutgoing('newest', info('new-pk'));

    expect(await getByPaymentHash('old0')).toBeNull();
    expect(await getByPaymentHash('old499')).not.toBeNull();
    expect(await getByPaymentHash('newest')).not.toBeNull();
  });
});
