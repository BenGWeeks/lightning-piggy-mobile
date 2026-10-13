import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { finalizeEvent, verifiedSymbol } from 'nostr-tools/pure';
import {
  __resetVerifiedEventCache,
  __verifiedEventCacheSize,
  verifyEventCached,
  flushVerifiedEventCache,
  hydrateVerifiedEventCache,
} from './nostrVerifyCache';

const key = new Uint8Array(32).fill(3);
const signed = () =>
  finalizeEvent({ kind: 1, created_at: 1700000000, content: 'hi', tags: [] }, key);

beforeEach(async () => {
  __resetVerifiedEventCache();
  await AsyncStorage.clear();
});
afterEach(() => __resetVerifiedEventCache());

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

it('rejects content and signature substitution after hydrating persisted trust', async () => {
  const event = signed();
  expect(verifyEventCached(event)).toBe(true);
  await flushVerifiedEventCache();
  __resetVerifiedEventCache();
  await hydrateVerifiedEventCache();
  expect(verifyEventCached({ ...event })).toBe(true);
  expect(verifyEventCached({ ...event, content: 'forged' })).toBe(false);
  expect(verifyEventCached({ ...event, sig: '0'.repeat(128) })).toBe(false);
});

it('does not trust nostr-tools verifiedSymbol supplied on a forged object', () => {
  const forged = { ...signed(), content: 'forged', [verifiedSymbol]: true };
  expect(verifyEventCached(forged)).toBe(false);
});

it('falls back to verification when persistent storage is corrupt', async () => {
  await AsyncStorage.setItem('nostr_verified_v1_00', 'invalid json');
  await hydrateVerifiedEventCache();
  expect(__verifiedEventCacheSize()).toBe(0);
  expect(verifyEventCached({ ...signed(), sig: '0'.repeat(128) })).toBe(false);
});

it('does not confer trust when storage cannot be read', async () => {
  const read = jest
    .spyOn(AsyncStorage, 'getItem')
    .mockRejectedValue(new Error('storage unavailable'));
  try {
    await hydrateVerifiedEventCache();
    expect(__verifiedEventCacheSize()).toBe(0);
    expect(verifyEventCached({ ...signed(), sig: '0'.repeat(128) })).toBe(false);
  } finally {
    read.mockRestore();
  }
});

it('fully verifies distinct valid Schnorr signatures for the same canonical event and id', async () => {
  const event = signed();
  const first = {
    ...event,
    sig: bytesToHex(schnorr.sign(hexToBytes(event.id), key, new Uint8Array(32))),
  };
  const second = {
    ...event,
    sig: bytesToHex(schnorr.sign(hexToBytes(event.id), key, new Uint8Array(32).fill(1))),
  };
  expect(first.id).toBe(second.id);
  expect(first.sig).not.toBe(second.sig);
  expect(verifyEventCached(first)).toBe(true);
  await flushVerifiedEventCache();
  __resetVerifiedEventCache();
  await hydrateVerifiedEventCache();
  expect(verifyEventCached(second)).toBe(true);
  expect(verifyEventCached({ ...second, sig: '0'.repeat(128), [verifiedSymbol]: true })).toBe(
    false,
  );
  expect(verifyEventCached(second)).toBe(true);
  expect(verifyEventCached(first)).toBe(true);
  expect(__verifiedEventCacheSize()).toBe(1);
});
