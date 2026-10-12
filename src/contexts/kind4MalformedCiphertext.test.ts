import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nip04 from 'nostr-tools/nip04';
import * as nip44 from 'nostr-tools/nip44';
import { getPublicKey } from 'nostr-tools/pure';
import { decryptInboxKind4 } from './inboxNip04Ingest';
import {
  Kind4RetryStore,
  KIND4_RETRY_BASE_MS,
  KIND4_MAX_UNCOUNTED_ATTEMPTS,
  KIND4_MAX_FAILURE_AGE_MS,
  isTransientKind4Error,
} from './kind4RetryStore';
import type { RawDmEvent } from '../services/nostrService';

jest.mock('./nostrSecretKeyCache', () => ({ nip04PlaintextCache: { set: jest.fn() } }));

const secret = new Uint8Array(32);
secret[31] = 1;
const peer = getPublicKey(secret);
const iv = 'AAAAAAAAAAAAAAAAAAAAAA==';
const block = 'AAAAAAAAAAAAAAAAAAAAAA==';
const conversationKey = nip44.v2.utils.getConversationKey(secret, peer);
const badMac = () => {
  const bytes = Buffer.from(nip44.v2.encrypt('hello', conversationKey), 'base64');
  bytes[bytes.length - 1] ^= 1;
  return nip44.v2.decrypt(bytes.toString('base64'), conversationKey);
};
const cases: [string, () => string, string][] = [
  [
    'invalid block length',
    () => nip04.decrypt(secret, peer, `AA==?iv=${iv}`),
    'aes-(cbc/ecb).decrypt ciphertext should consist of blocks with size 16',
  ],
  [
    'empty ciphertext',
    () => nip04.decrypt(secret, peer, `?iv=${iv}`),
    'aes/pcks5: empty ciphertext not allowed',
  ],
  [
    'invalid Base64 alphabet',
    () => nip04.decrypt(secret, peer, `!!!!?iv=${iv}`),
    'Unknown letter: "!". Allowed: ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
  ],
  [
    'invalid Base64 padding',
    () => nip04.decrypt(secret, peer, `A?iv=${iv}`),
    'padding: invalid, string should have whole number of bytes',
  ],
  [
    'bad AES padding',
    () => nip04.decrypt(secret, peer, `${block}?iv=${iv}`),
    'aes/pcks5: wrong padding',
  ],
  [
    'bad IV',
    () => nip04.decrypt(secret, peer, `${block}?iv=AA==`),
    '"nonce" expected Uint8Array of length 16, got length=1',
  ],
  // NIP-04 CBC has no MAC. Exercise the installed NIP-44 crypto's actual MAC error.
  ['invalid MAC', badMac, 'invalid MAC'],
];
let now: number;
beforeEach(async () => {
  now = 1000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  await AsyncStorage.clear();
});
afterEach(() => jest.restoreAllMocks());

const target = {
  ev: { id: 'bad', content: 'malformed', created_at: 100 } as RawDmEvent,
  fromMe: false,
  partnerPubkey: peer,
};
async function ingest(store: Kind4RetryStore, decrypt: () => Promise<string>) {
  return decryptInboxKind4({
    owner: 'owner',
    targets: [target],
    decrypt,
    failures: store,
    isColdStart: false,
  });
}

it.each(cases)(
  'counts real %s errors, exhausts after three attempts and releases the cursor',
  async (_name, reproduce, message) => {
    let error: unknown;
    try {
      reproduce();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).constructor).toBe(Error);
    expect((error as Error).message).toBe(message);
    expect(isTransientKind4Error(error)).toBe(false);
    const decrypt = jest.fn(async () => reproduce());
    let store = new Kind4RetryStore('owner');
    await store.load();
    for (let i = 0; i < 3; i++) {
      expect((await ingest(store, decrypt)).attempts).toBe(1);
      expect(store.cursor(1000)).toBe(i < 2 ? 100 : 1000);
      now += KIND4_RETRY_BASE_MS * 2 ** i;
      await store.save();
      store = new Kind4RetryStore('owner');
      await store.load();
    }
    expect((await ingest(store, decrypt)).attempts).toBe(0);
    expect(decrypt).toHaveBeenCalledTimes(3);
    expect(store.cursor(1000)).toBe(1000);
    expect(store.nextRetryAt()).toBeUndefined();
  },
);

it('negative-caches a transient failure at twenty uncounted attempts across restart', async () => {
  const log = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const decrypt = jest.fn(async (): Promise<string> => {
    throw new Error('opaque signer failure');
  });
  let store = new Kind4RetryStore('owner');
  await store.load();
  for (let i = 0; i < KIND4_MAX_UNCOUNTED_ATTEMPTS; i++) {
    expect((await ingest(store, decrypt)).attempts).toBe(1);
    expect(store.cursor(1000)).toBe(i < KIND4_MAX_UNCOUNTED_ATTEMPTS - 1 ? 100 : 1000);
    now += KIND4_RETRY_BASE_MS;
    await store.save();
    store = new Kind4RetryStore('owner');
    await store.load();
  }
  expect((await ingest(store, decrypt)).attempts).toBe(0);
  expect(store.nextRetryAt()).toBeUndefined();
  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('[Perf] kind4 retry ceiling'));
  // Explicit refresh still permits recovery from a negative cache entry.
  expect(store.shouldSkip('bad', true)).toBe(false);
});

it('releases the cursor after seven days even when the relay omits the failed event', async () => {
  const log = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const store = new Kind4RetryStore('owner');
  await store.load();
  store.failed('bad', 100, false);
  await store.save();
  const restarted = new Kind4RetryStore('owner');
  await restarted.load();
  now += KIND4_MAX_FAILURE_AGE_MS - 1;
  expect(restarted.cursor(1000)).toBe(100);
  now++;
  expect(restarted.cursor(1000)).toBe(1000);
  expect(restarted.shouldSkip('bad')).toBe(true);
  expect(restarted.nextRetryAt()).toBeUndefined();
  expect(log).toHaveBeenCalledTimes(1);
  await restarted.save();
  const permanent = new Kind4RetryStore('owner');
  await permanent.load();
  expect(permanent.shouldSkip('bad')).toBe(true);
});

it('migrates round-5 metadata and ages it from its last known failure', async () => {
  await AsyncStorage.setItem(
    'dm-kind4-retries:owner',
    JSON.stringify([{ id: 'bad', createdAt: 100, attempts: 0, lastAttempt: now }]),
  );
  const store = new Kind4RetryStore('owner');
  await store.load();
  expect(store.cursor(1000)).toBe(100);
  now += KIND4_MAX_FAILURE_AGE_MS;
  expect(store.cursor(1000)).toBe(1000);
});

it('retains the first failure time across later attempts and expires mixed failures', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const store = new Kind4RetryStore('owner');
  await store.load();
  store.failed('bad', 100, true);
  now += KIND4_MAX_FAILURE_AGE_MS - 1;
  store.failed('bad', 100, false);
  expect(store.cursor(1000)).toBe(100);
  now++;
  expect(store.cursor(1000)).toBe(1000);
  expect(store.shouldSkip('bad')).toBe(true);
});

it('expires a transient failure before another decrypt at the age ceiling', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const store = new Kind4RetryStore('owner');
  await store.load();
  const decrypt = jest.fn(async (): Promise<string> => {
    throw new Error('network offline');
  });
  await ingest(store, decrypt);
  now += KIND4_MAX_FAILURE_AGE_MS;
  expect((await ingest(store, decrypt)).attempts).toBe(0);
  expect(decrypt).toHaveBeenCalledTimes(1);
  expect(store.cursor(1000)).toBe(1000);
});
