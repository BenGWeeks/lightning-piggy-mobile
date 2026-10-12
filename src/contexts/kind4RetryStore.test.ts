import { AmberSignerError } from '../services/amberErrors';
import { NostrConnectError, SignerUnavailableError } from '../services/signerErrors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Kind4RetryStore,
  KIND4_RETRY_BASE_MS,
  KIND4_MAX_UNCOUNTED_ATTEMPTS,
  KIND4_MAX_FAILURE_AGE_MS,
  isTransientKind4Error,
} from './kind4RetryStore';

beforeEach(async () => {
  jest.spyOn(Date, 'now').mockReturnValue(1000);
  await AsyncStorage.clear();
});
afterEach(() => jest.restoreAllMocks());

it('persists backoff and the oldest retryable floor until three counted failures', async () => {
  const store = new Kind4RetryStore('owner');
  await store.load();
  store.failed('old', 100, false, 1000);
  store.failed('new', 800, true, 1000);
  await store.save();
  const restarted = new Kind4RetryStore('owner');
  await restarted.load();
  expect(restarted.cursor(1000)).toBe(100);
  expect(restarted.shouldSkip('old', false, 1001)).toBe(true);
  expect(restarted.shouldSkip('old', false, 1000 + KIND4_RETRY_BASE_MS)).toBe(false);
  restarted.succeeded('old');
  restarted.failed('new', 800, true, 61_000);
  expect(restarted.nextRetryAt()).toBe(181_000);
  restarted.failed('new', 800, true, 181_000);
  expect(restarted.cursor(1000)).toBe(1000);
  expect(restarted.nextRetryAt()).toBeUndefined();
  await restarted.save();
  const permanent = new Kind4RetryStore('owner');
  await permanent.load();
  expect(permanent.shouldSkip('new', false, 10_000_000)).toBe(true);
  expect(permanent.shouldSkip('new', true)).toBe(false);
});

it('bounds persisted metadata to 500 entries, preferring to evict permanent failures', async () => {
  const store = new Kind4RetryStore('owner');
  await store.load();
  for (let i = 0; i < 501; i++) {
    store.failed(String(i), i, true, 1000);
    if (i === 0) {
      store.failed('0', 0, true, 1000);
      store.failed('0', 0, true, 1000);
    }
  }
  await store.save();
  const metadata = JSON.parse((await AsyncStorage.getItem('dm-kind4-retries:owner'))!);
  expect(metadata).toHaveLength(500);
  expect(metadata.some((f: { id: string }) => f.id === '0')).toBe(false);
  expect(store.cursor(1000)).toBe(1);
});

it.each([
  'Signer unavailable',
  'NIP-46 signer not connected',
  'request timed out',
  'network offline',
])('classifies availability errors without consuming the event budget: %s', (message) => {
  expect(isTransientKind4Error(new Error(message))).toBe(true);
  expect(isTransientKind4Error(new Error('invalid ciphertext'))).toBe(false);
});

it('exhausts the oldest pending failure before evicting it at capacity', async () => {
  const store = new Kind4RetryStore('owner');
  await store.load();
  for (let i = 0; i < 501; i++) store.failed(String(i), i, false, 1000);
  await store.save();
  expect(store.cursor(1000)).toBe(1);
  expect(store.shouldSkip('0')).toBe(true);
  expect(JSON.parse((await AsyncStorage.getItem('dm-kind4-retries:owner'))!)).toHaveLength(500);
});

it.each([
  [
    'Amber',
    new AmberSignerError('BUSY', 'busy', 'invalid MAC'),
    new AmberSignerError('DECRYPT_FAILED', 'failed', 'invalid MAC'),
  ],
  [
    'NIP-46',
    new NostrConnectError('unavailable', 'invalid MAC'),
    new NostrConnectError('decrypt-failed', 'opaque remote failure'),
  ],
  ['nsec', new SignerUnavailableError('invalid MAC'), new Error('bad padding')],
])(
  'splits transient and ciphertext failures for %s using structure first',
  (_signer, transient, permanent) => {
    expect(isTransientKind4Error(transient)).toBe(true);
    expect(isTransientKind4Error(permanent)).toBe(false);
  },
);

it.each([
  new AmberSignerError('UNKNOWN', 'failed', 'opaque native failure'),
  new NostrConnectError('failed', 'opaque bunker failure'),
  new Error('opaque local failure'),
  { code: 'NO_RESULT', message: 'invalid MAC' },
  new AmberSignerError('CANCELLED', 'declined', 'invalid MAC'),
  new AmberSignerError('NO_ACTIVITY', 'unavailable', 'invalid MAC'),
  new AmberSignerError('NO_RESULT', 'no-response', 'invalid MAC'),
])('keeps unknown and availability signer errors retryable: %s', (error) => {
  expect(isTransientKind4Error(error)).toBe(true);
});

it.each(['counted', 'uncounted', 'age'] as const)(
  'keeps overflow exhaustion across 11,000 overlap replays and restart (%s ceiling)',
  async (ceiling) => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    let store = new Kind4RetryStore('owner');
    await store.load();
    // 501 failed events span 50 seconds: all remain inside the 120-second overlap.
    const events = Array.from({ length: 501 }, (_, i) => ({
      id: String(i),
      createdAt: 100 + Math.floor(i / 10),
    }));
    let cursor = 0;
    let attempts = 0;
    let attemptsAtExhaustion = 0;
    const ceilingPass =
      ceiling === 'age'
        ? KIND4_MAX_FAILURE_AGE_MS / KIND4_RETRY_BASE_MS
        : ceiling === 'counted'
          ? 4
          : KIND4_MAX_UNCOUNTED_ATTEMPTS;
    for (let pass = 0; pass < 11_000; pass++) {
      for (const event of events) {
        if (event.createdAt < cursor - 120) continue;
        // The age path exercises bounded relay slices omitting pending events.
        if (ceiling === 'age' && pass > 0 && event.id !== '500') continue;
        if (!store.shouldSkip(event.id)) {
          attempts++;
          store.failed(event.id, event.createdAt, ceiling === 'counted');
        }
      }
      const next = store.cursor(150);
      expect(next).toBeGreaterThanOrEqual(cursor);
      cursor = next;
      if (pass === ceilingPass) attemptsAtExhaustion = attempts;
      if (pass >= ceilingPass) {
        expect(cursor).toBe(150);
        expect(store.nextRetryAt()).toBeUndefined();
        expect(attempts).toBe(attemptsAtExhaustion);
      }
      now += KIND4_RETRY_BASE_MS;
      if (pass <= Math.min(ceilingPass, 20) || pass === ceilingPass) {
        await store.save();
        store = new Kind4RetryStore('owner');
        await store.load();
      }
    }
    expect(attempts).toBeGreaterThanOrEqual(501);
    expect(attempts).toBeLessThanOrEqual(501 * (ceiling === 'uncounted' ? 20 : 3));
    // A replay of the full slice must remain exhausted, including the evicted id.
    for (const event of events) expect(store.shouldSkip(event.id)).toBe(true);
    expect(store.retryDelay()).toBeUndefined();
  },
  30_000,
);

it('bounds persisted exhausted ids and discards oldest history regardless of insertion order', async () => {
  const negatives = Array.from({ length: 5001 }, (_, i) => [String(i), 5000 - i]);
  await AsyncStorage.setItem('dm-kind4-exhausted:owner', JSON.stringify(negatives));
  const store = new Kind4RetryStore('owner');
  await store.load();
  await store.save();
  const saved = JSON.parse((await AsyncStorage.getItem('dm-kind4-exhausted:owner'))!);
  expect(saved).toHaveLength(5000);
  expect(store.shouldSkip('0')).toBe(true);
  expect(store.shouldSkip('5000')).toBe(false);
});

it('retains evicted exhaustion after a failed bypass and clears it only on successful recovery', async () => {
  const store = new Kind4RetryStore('owner');
  await store.load();
  for (let i = 0; i < 501; i++) store.failed(String(i), i, false);
  expect(store.shouldSkip('0', true)).toBe(false);
  store.failed('0', 0, false);
  await store.save();
  const restarted = new Kind4RetryStore('owner');
  await restarted.load();
  expect(restarted.shouldSkip('0')).toBe(true);
  expect(restarted.cursor(1000)).toBe(1);
  const other = new Kind4RetryStore('other');
  await other.load();
  expect(other.shouldSkip('0')).toBe(false);
  restarted.succeeded('0');
  await restarted.save();
  const recovered = new Kind4RetryStore('owner');
  await recovered.load();
  expect(recovered.shouldSkip('0')).toBe(false);
});
