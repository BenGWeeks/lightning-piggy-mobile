import { finalizeEvent } from 'nostr-tools/pure';
import {
  __resetVerifiedEventCache,
  __verifiedEventCacheSize,
  verifyEventCached,
} from './nostrVerifyCache';

const key = new Uint8Array(32).fill(3);
const signed = () =>
  finalizeEvent({ kind: 1, created_at: 1700000000, content: 'hi', tags: [] }, key);

beforeEach(() => __resetVerifiedEventCache());

it('verifies once, then serves the same event from the cache', () => {
  const event = signed();
  expect(verifyEventCached({ ...event })).toBe(true);
  expect(__verifiedEventCacheSize()).toBe(1);
  expect(verifyEventCached(JSON.parse(JSON.stringify(event)))).toBe(true);
});

it('rejects a forged payload that reuses a cached id', () => {
  const event = signed();
  expect(verifyEventCached({ ...event })).toBe(true);
  const forged = JSON.parse(JSON.stringify({ ...event, content: 'pay me instead' }));
  expect(verifyEventCached(forged)).toBe(false);
});

it('does not cache events that fail the signature check', () => {
  const bad = JSON.parse(JSON.stringify({ ...signed(), sig: '0'.repeat(128) }));
  expect(verifyEventCached(bad)).toBe(false);
  expect(__verifiedEventCacheSize()).toBe(0);
});
