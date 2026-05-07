/**
 * Storage-layer tests for zap counterparty caching, with focus on the
 * negative-cache TTL added in #127. Without negative caching, every cold
 * start re-runs the 500-event #P-tag relay scan for txs whose receipts
 * don't exist (legacy LNbits sends, non-NIP-57 lightning addresses, …)
 * — observed as the ~20s delay before avatars appeared on the Home tab.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as storage from './zapCounterpartyStorage';
import type { ZapCounterpartyInfo } from '../types/wallet';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const samplePositive: ZapCounterpartyInfo = {
  pubkey: 'a'.repeat(64),
  profile: {
    npub: 'npub1abc',
    name: 'Alice',
    displayName: 'Alice',
    picture: null,
    nip05: null,
  },
  comment: 'thanks',
  anonymous: false,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  storage.__resetForTests();
});

describe('zapCounterpartyStorage — positive attributions', () => {
  it('round-trips a recorded positive attribution', async () => {
    await storage.recordOutgoing('hash-1', samplePositive);
    const map = await storage.getMany(['hash-1']);
    expect(map.get('hash-1')).toEqual(samplePositive);
  });

  it('returns no entry when the payment hash is unknown', async () => {
    const map = await storage.getMany(['never-seen']);
    expect(map.has('never-seen')).toBe(false);
  });
});

describe('zapCounterpartyStorage — negative attributions (issue #127)', () => {
  it('records a fresh negative attribution as a null hit', async () => {
    await storage.recordOutgoingMiss('hash-miss');
    const map = await storage.getMany(['hash-miss']);
    // `has` true + value null is the signal "skip the relay scan,
    // we already know there's nothing there".
    expect(map.has('hash-miss')).toBe(true);
    expect(map.get('hash-miss')).toBeNull();
  });

  it('drops a stale negative attribution so the resolver retries', async () => {
    // Write at "now", then jump the clock past the 7-day TTL window.
    const realNow = Date.now;
    const fakeStart = 1_700_000_000_000;
    Date.now = jest.fn(() => fakeStart);
    try {
      await storage.recordOutgoingMiss('hash-stale');
      Date.now = jest.fn(() => fakeStart + 8 * 24 * 60 * 60 * 1000);
      const map = await storage.getMany(['hash-stale']);
      expect(map.has('hash-stale')).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  it('keeps positive attributions forever (no TTL)', async () => {
    const realNow = Date.now;
    const fakeStart = 1_700_000_000_000;
    Date.now = jest.fn(() => fakeStart);
    try {
      await storage.recordOutgoing('hash-old-positive', samplePositive);
      Date.now = jest.fn(() => fakeStart + 365 * 24 * 60 * 60 * 1000);
      const map = await storage.getMany(['hash-old-positive']);
      expect(map.get('hash-old-positive')).toEqual(samplePositive);
    } finally {
      Date.now = realNow;
    }
  });

  it('mixes positive + negative + miss in a single bulk lookup', async () => {
    await storage.recordOutgoing('hash-pos', samplePositive);
    await storage.recordOutgoingMiss('hash-neg');
    const map = await storage.getMany(['hash-pos', 'hash-neg', 'hash-unknown']);
    expect(map.get('hash-pos')).toEqual(samplePositive);
    expect(map.has('hash-neg')).toBe(true);
    expect(map.get('hash-neg')).toBeNull();
    expect(map.has('hash-unknown')).toBe(false);
  });

  it('lets a positive write upgrade a previously cached negative', async () => {
    // Race case: resolver wrote a negative for a payment whose receipt
    // was published late. SendSheet (or a later relay scan) finding the
    // attribution should overwrite the negative cleanly.
    await storage.recordOutgoingMiss('hash-upgrade');
    await storage.recordOutgoing('hash-upgrade', samplePositive);
    const map = await storage.getMany(['hash-upgrade']);
    expect(map.get('hash-upgrade')).toEqual(samplePositive);
  });
});

describe('zapCounterpartyStorage — write-version + persistence', () => {
  it('bumps writeVersion on every record so the resolver fingerprint changes', async () => {
    const before = storage.getWriteVersion();
    await storage.recordOutgoingMiss('hash-bump');
    expect(storage.getWriteVersion()).toBeGreaterThan(before);
  });

  it('persists negative entries across an in-memory cache reset', async () => {
    await storage.recordOutgoingMiss('hash-persist');
    storage.__resetForTests(); // simulate cold start (memoryCache cleared)
    const map = await storage.getMany(['hash-persist']);
    expect(map.has('hash-persist')).toBe(true);
    expect(map.get('hash-persist')).toBeNull();
  });
});
