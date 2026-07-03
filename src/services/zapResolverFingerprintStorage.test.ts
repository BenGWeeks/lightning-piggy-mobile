/**
 * Round-trip coverage for the persisted zap-resolver fingerprint (#526).
 * Mirrors the AsyncStorage-mock pattern used by zapSenderProfileStorage /
 * zapCounterpartyStorage so the diff scans the same way.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import { __resetForTests, get, set } from './zapResolverFingerprintStorage';
import type { ResolverFingerprint } from '../utils/zapResolverGuard';

const STORAGE_KEY = 'zap_resolver_fingerprints_v1';

const fp = (pendingHash: string, storageVersion: number): ResolverFingerprint => ({
  pendingHash,
  storageVersion,
});

describe('zapResolverFingerprintStorage', () => {
  beforeEach(async () => {
    __resetForTests();
    await AsyncStorage.clear();
  });

  it('returns null for a wallet that has never resolved', async () => {
    expect(await get('wallet-a')).toBeNull();
  });

  it('round-trips a fingerprint for a wallet', async () => {
    await set('wallet-a', fp('hash-1', 7));
    expect(await get('wallet-a')).toEqual(fp('hash-1', 7));
  });

  it('keeps fingerprints isolated per wallet', async () => {
    await set('wallet-a', fp('hash-a', 1));
    await set('wallet-b', fp('hash-b', 2));
    expect(await get('wallet-a')).toEqual(fp('hash-a', 1));
    expect(await get('wallet-b')).toEqual(fp('hash-b', 2));
  });

  it('overwrites the previous fingerprint for the same wallet', async () => {
    await set('wallet-a', fp('hash-old', 1));
    await set('wallet-a', fp('hash-new', 2));
    expect(await get('wallet-a')).toEqual(fp('hash-new', 2));
  });

  it('survives an in-memory mirror reset (re-reads from storage)', async () => {
    await set('wallet-a', fp('hash-1', 3));
    __resetForTests();
    expect(await get('wallet-a')).toEqual(fp('hash-1', 3));
  });

  it('persists under the namespaced storage key', async () => {
    await set('wallet-a', fp('hash-1', 3));
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ 'wallet-a': fp('hash-1', 3) });
  });

  it('ignores an empty walletId on both get and set', async () => {
    await set('', fp('hash-x', 9));
    expect(await get('')).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('tolerates corrupt stored JSON — resolves to null, not a throw', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not valid json');
    __resetForTests();
    expect(await get('wallet-a')).toBeNull();
  });
});
