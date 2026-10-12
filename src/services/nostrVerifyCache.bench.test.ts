import type { Event } from 'nostr-tools/pure';
import { nostrVerifyEvent } from './nostrCrypto';
import {
  __resetVerifiedEventCache,
  __verifiedEventCacheSize,
  verifyEventCached,
} from './nostrVerifyCache';

// Count crypto calls, not host CPU timing: deterministic, offline, and no
// claim that Jest/V8 milliseconds predict a Pixel/Hermes frame budget.
jest.mock('./nostrCrypto', () => ({
  nostrGetEventHash: (event: Event) => event.id,
  nostrVerifyEvent: jest.fn(() => true),
}));
const verify = jest.mocked(nostrVerifyEvent);
const event = (id: number) => ({ id: id.toString(16).padStart(64, '0') }) as Event;
const replay = (events: Event[]) => {
  const before = verify.mock.calls.length;
  for (const e of events) expect(verifyEventCached(e)).toBe(true);
  return verify.mock.calls.length - before;
};

beforeEach(() => {
  __resetVerifiedEventCache();
  verify.mockClear();
});

it('keeps 1,200 replayed inbox ids hot across unrelated feed churn (FIFO regression)', () => {
  const known = Array.from({ length: 1200 }, (_, i) => event(i));
  const fresh = Array.from({ length: 25 }, (_, i) => event(10_000 + i));
  expect(replay(known)).toBe(1200);
  // A busy app fills the rest of its bounded shared cache with other feeds.
  expect(replay(Array.from({ length: 8800 }, (_, i) => event(1200 + i)))).toBe(8800);
  const first = replay([...known, ...fresh]);
  const second = replay([...known, ...fresh]);
  process.stdout.write(
    `[PerfBlock] verifiedInbox fixture=1200-known+25-new first=${first} repeat=${second}\n`,
  );
  expect(first).toBe(25);
  expect(second).toBe(0);
  expect(__verifiedEventCacheSize()).toBe(10_000);
});

it('does not verify events already in memory on a normal warm refresh', () => {
  const known = Array.from({ length: 1200 }, (_, i) => event(i));
  replay(known);
  verify.mockClear();
  expect(replay([...known, ...Array.from({ length: 25 }, (_, i) => event(1200 + i))])).toBe(25);
  expect(replay(known)).toBe(0);
});
