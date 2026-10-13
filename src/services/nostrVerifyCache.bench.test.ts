import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Event } from 'nostr-tools/pure';
import { nostrVerifyEvent } from './nostrCrypto';
import {
  __resetVerifiedEventCache,
  __verifiedEventCacheSize,
  verifyEventCached,
  flushVerifiedEventCache,
  hydrateVerifiedEventCache,
} from './nostrVerifyCache';

// Count crypto calls, not host CPU timing: deterministic, offline, and no
// claim that Jest/V8 milliseconds predict a Pixel/Hermes frame budget.
jest.mock('./nostrCrypto', () => ({
  nostrGetEventHash: (event: Event) => event.id,
  nostrVerifyEvent: jest.fn(() => true),
}));
const verify = jest.mocked(nostrVerifyEvent);
const event = (id: number) =>
  ({
    id: (id % 256).toString(16).padStart(2, '0') + id.toString(16).padStart(62, '0'),
    sig: 'a'.repeat(128),
  }) as Event;
const replay = (events: Event[]) => {
  const before = verify.mock.calls.length;
  for (const e of events) expect(verifyEventCached(e)).toBe(true);
  return verify.mock.calls.length - before;
};

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetVerifiedEventCache();
  verify.mockClear();
});

afterEach(() => __resetVerifiedEventCache());

it('keeps 1,200 replayed inbox ids hot across unrelated feed churn (FIFO regression)', () => {
  const known = Array.from({ length: 1200 }, (_, i) => event(i));
  const fresh = Array.from({ length: 25 }, (_, i) => event(20_000 + i));
  expect(replay(known)).toBe(1200);
  // A busy app fills the rest of its bounded shared cache with other feeds.
  expect(replay(Array.from({ length: 18800 }, (_, i) => event(1200 + i)))).toBe(18800);
  const first = replay([...known, ...fresh]);
  const second = replay([...known, ...fresh]);
  process.stdout.write(
    `[PerfBlock] verifiedInbox fixture=1200-known+25-new first=${first} repeat=${second}\n`,
  );
  expect(first).toBe(25);
  expect(second).toBe(0);
  expect(__verifiedEventCacheSize()).toBe(20_000);
});

it('does not verify events already in memory on a normal warm refresh', () => {
  const known = Array.from({ length: 1200 }, (_, i) => event(i));
  replay(known);
  verify.mockClear();
  expect(replay([...known, ...Array.from({ length: 25 }, (_, i) => event(1200 + i))])).toBe(25);
  expect(replay(known)).toBe(0);
});

it('cold refresh of 1,300 persisted events performs zero Schnorr checks after restart', async () => {
  const fixture = Array.from({ length: 1300 }, (_, i) => event(i));
  expect(replay(fixture)).toBe(1300);
  await flushVerifiedEventCache();
  __resetVerifiedEventCache();
  verify.mockClear();
  await hydrateVerifiedEventCache();
  const after = replay(fixture);
  process.stdout.write(`[PerfBlock] coldRefresh fixture=1300 before=1300 after=${after}\n`);
  expect(after).toBe(0);
});
