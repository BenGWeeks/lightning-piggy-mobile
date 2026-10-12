import AsyncStorage from '@react-native-async-storage/async-storage';
import { Kind4RetryStore, KIND4_RETRY_BASE_MS, isTransientKind4Error } from './kind4RetryStore';

beforeEach(() => AsyncStorage.clear());

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

it('keeps the oldest pending failure when the retry store reaches capacity', async () => {
  const store = new Kind4RetryStore('owner');
  await store.load();
  for (let i = 0; i < 501; i++) store.failed(String(i), i, false, 1000);
  await store.save();
  expect(store.cursor(1000)).toBe(0);
  expect(JSON.parse((await AsyncStorage.getItem('dm-kind4-retries:owner'))!)).toHaveLength(500);
});
