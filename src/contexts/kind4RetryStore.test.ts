import { AmberSignerError } from '../services/amberErrors';
import { NostrConnectError, SignerUnavailableError } from '../services/signerErrors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Kind4RetryStore,
  loadKind4ReplayCursor,
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
  const store = new Kind4RetryStore('owner', 500, 5000);
  await store.load();
  store.failed('old', 100, false, 1000);
  store.failed('new', 800, true, 1000);
  await store.save();
  const restarted = new Kind4RetryStore('owner', 500, 5000);
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
  const permanent = new Kind4RetryStore('owner', 500, 5000);
  await permanent.load();
  expect(permanent.shouldSkip('new', false, 10_000_000)).toBe(true);
  expect(permanent.shouldSkip('new', true)).toBe(false);
});

it('bounds persisted metadata to 500 entries, preferring to evict permanent failures', async () => {
  const store = new Kind4RetryStore('owner', 500, 5000);
  await store.load();
  for (let i = 0; i < 501; i++) {
    store.failed(String(i), i, true, 1000);
    if (i === 0) {
      store.failed('0', 0, true, 1000);
      store.failed('0', 0, true, 1000);
    }
  }
  await store.save();
  const metadata = JSON.parse((await AsyncStorage.getItem('dm-kind4-retries:owner'))!).failures;
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
  const store = new Kind4RetryStore('owner', 500, 5000);
  await store.load();
  for (let i = 0; i < 501; i++) store.failed(String(i), i, false, 1000);
  await store.save();
  expect(store.cursor(1000)).toBe(1);
  expect(store.shouldSkip('0')).toBe(true);
  expect(JSON.parse((await AsyncStorage.getItem('dm-kind4-retries:owner'))!).failures).toHaveLength(
    500,
  );
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
    let store = new Kind4RetryStore('owner', 500, 5000);
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
        store = new Kind4RetryStore('owner', 500, 5000);
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

it('loads legacy exhaustion without forgetting replayable ids at the old cap', async () => {
  const negatives = Array.from({ length: 5501 }, (_, i) => [String(i), 100 + Math.floor(i / 110)]);
  await AsyncStorage.setItem('dm-kind4-exhausted:owner', JSON.stringify(negatives));
  const store = new Kind4RetryStore('owner');
  await store.load();
  expect(store.cursor(150)).toBe(150);
  await store.save();
  const saved = JSON.parse((await AsyncStorage.getItem('dm-kind4-retries:owner'))!);
  expect(saved.entries).toHaveLength(5501);
  for (const [id] of negatives) expect(store.shouldSkip(String(id))).toBe(true);
});

it('retains evicted exhaustion after a failed bypass and clears it only on successful recovery', async () => {
  const store = new Kind4RetryStore('owner', 500, 5000);
  await store.load();
  for (let i = 0; i < 501; i++) store.failed(String(i), i, false);
  expect(store.shouldSkip('0', true)).toBe(false);
  store.failed('0', 0, false);
  await store.save();
  const restarted = new Kind4RetryStore('owner', 500, 5000);
  await restarted.load();
  expect(restarted.shouldSkip('0')).toBe(true);
  expect(restarted.cursor(1000)).toBe(1);
  const other = new Kind4RetryStore('other');
  await other.load();
  expect(other.shouldSkip('0')).toBe(false);
  restarted.succeeded('0');
  await restarted.save();
  const recovered = new Kind4RetryStore('owner', 500, 5000);
  await recovered.load();
  expect(recovered.shouldSkip('0')).toBe(false);
});

it.each([
  [5501, undefined, true],
  [5501, 500, true],
  [10001, undefined, true],
  [5501, undefined, false],
] as const)(
  'bounds %i failures within 50 seconds across every saved/restarted pass (capacity %s, counted %s)',
  async (count, capacity, counted) => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const events = Array.from({ length: count }, (_, i) => ({
      id: String(i),
      createdAt: 100 + Math.floor((i * 50) / (count - 1)),
    }));
    let store = new Kind4RetryStore('owner', capacity);
    await store.load();
    let cursor = 0;
    let attempts = 0;
    let exhaustedAttempts = 0;
    for (let pass = 0; pass < 100; pass++) {
      for (const event of events) {
        if (event.createdAt < cursor - 120 || store.shouldSkip(event.id)) continue;
        attempts++;
        store.failed(event.id, event.createdAt, counted);
      }
      const next = store.cursor(150);
      expect(next).toBeGreaterThanOrEqual(cursor);
      cursor = next;
      if (pass === 20) exhaustedAttempts = attempts;
      if (pass >= 20) {
        expect(attempts).toBe(exhaustedAttempts);
        expect(store.nextRetryAt()).toBeUndefined();
      }
      await store.save();
      store = new Kind4RetryStore('owner', capacity);
      await store.load();
      expect(store.cursor(0)).toBe(cursor);
      now += KIND4_RETRY_BASE_MS;
    }
    expect(attempts).toBeGreaterThanOrEqual(count);
    expect(attempts).toBeLessThanOrEqual(count * (counted ? 3 : KIND4_MAX_UNCOUNTED_ATTEMPTS));
    expect(store.retryDelay()).toBeUndefined();
    for (const event of events)
      if (event.createdAt >= cursor - 120) expect(store.shouldSkip(event.id)).toBe(true);
  },
  30_000,
);

it('retains exhaustion at the inclusive replay boundary and prunes only behind it', async () => {
  const store = new Kind4RetryStore('owner', 1);
  await store.load();
  for (let i = 0; i < 3; i++) store.failed('boundary', 100, true);
  expect(store.cursor(220)).toBe(220);
  await store.save();
  expect(store.shouldSkip('boundary')).toBe(true);
  for (let i = 0; i < 3; i++) store.failed('new', 220, true);
  // At capacity with both entries replayable, moving the cursor makes the
  // oldest entry strictly older than the inclusive `since` before pruning.
  expect(store.cursor(220)).toBe(221);
  await store.save();
  const restarted = new Kind4RetryStore('owner');
  await restarted.load();
  expect(restarted.cursor(0)).toBe(221);
  expect(restarted.shouldSkip('boundary')).toBe(false);
});

it('asserts the fetch bound including both directions and default relays', () => {
  const store = new Kind4RetryStore('owner');
  expect(() => store.configureFetch([], 10000)).not.toThrow();
  expect(() => store.configureFetch([], 10001)).toThrow('per-filter relay limit');
  expect(() => new Kind4RetryStore('owner', 0)).toThrow('capacity');
});

it('keeps the committed snapshot intact when the atomic metadata write fails', async () => {
  const store = new Kind4RetryStore('owner', 1);
  await store.load();
  store.failed('old', 100, false);
  store.cursor(150);
  await store.save();
  const before = await AsyncStorage.getItem('dm-kind4-retries:owner');
  const pass = store.beginPass();
  pass.failed('new', 220, false);
  for (let i = 0; i < 3; i++) pass.failed('new', 220, true);
  expect(pass.cursor(220)).toBe(221);
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(store.commitPass(pass, 220)).rejects.toThrow('storage unavailable');
  expect(store.committedCursor()).toBe(100);
  expect(await AsyncStorage.getItem('dm-kind4-retries:owner')).toBe(before);
  const restarted = new Kind4RetryStore('owner', 1);
  await restarted.load();
  expect(restarted.committedCursor()).toBe(100);
  expect(restarted.shouldSkip('new')).toBe(false);
  expect(restarted.nextRetryAt()).toBeDefined();
});

it('keeps pruning victims exhausted throughout the proposal and applies pruning at commit', async () => {
  const store = new Kind4RetryStore('owner', 1);
  await store.load();
  for (let i = 0; i < 3; i++) store.failed('old', 100, true);
  store.cursor(150);
  await store.save();
  const before = await AsyncStorage.getItem('dm-kind4-retries:owner');
  const pass = store.beginPass();
  for (let i = 0; i < 3; i++) pass.failed('new', 220, true);
  expect(pass.cursor(220)).toBe(221);
  expect(pass.shouldSkip('old')).toBe(true);
  expect(store.committedCursor()).toBe(150);
  expect(await AsyncStorage.getItem('dm-kind4-retries:owner')).toBe(before);
  await store.commitPass(pass, 220);
  expect(store.committedCursor()).toBe(221);
  expect(store.shouldSkip('old')).toBe(false);
  expect(store.shouldSkip('new')).toBe(true);
  const restarted = new Kind4RetryStore('owner', 1);
  await restarted.load();
  expect(restarted.committedCursor()).toBe(221);
  expect(restarted.shouldSkip('new')).toBe(true);
});

it('shares the committed cursor with other readers and uses legacy keys only before migration', async () => {
  expect(await loadKind4ReplayCursor('owner')).toBeUndefined();
  expect(await loadKind4ReplayCursor('owner', 150)).toBe(150);
  await AsyncStorage.setItem(
    'dm-kind4-exhausted:owner',
    JSON.stringify({ cursor: 150, entries: [] }),
  );
  const store = new Kind4RetryStore('owner');
  await store.load();
  const pass = store.beginPass();
  pass.failed('pending', 100, false);
  await store.commitPass(pass, 150);
  expect(await loadKind4ReplayCursor('owner', 999)).toBe(150);
  await AsyncStorage.setItem(
    'dm-kind4-exhausted:owner',
    JSON.stringify({ cursor: 999, entries: [] }),
  );
  expect(await loadKind4ReplayCursor('owner', 999)).toBe(150);
});

test('a failed storage read is not cached; the next load retries', async () => {
  const getItem = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('io'));
  const store = new Kind4RetryStore('owner');
  await expect(store.load()).rejects.toThrow('io');
  await expect(store.load()).resolves.toBeUndefined();
  getItem.mockRestore();
});
