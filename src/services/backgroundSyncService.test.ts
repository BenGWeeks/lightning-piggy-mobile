// Tests for the detect-and-ping background sync (#279). The relay pool,
// identity/relay storage, and notificationService are mocked so we assert
// the detection + cursor logic without network or native modules.

const mockQuerySync = jest.fn();
const mockLoadIdentities = jest.fn();
const mockGetUserRelays = jest.fn();
const mockFireMessageNotification = jest.fn().mockResolvedValue('id');

jest.mock('./nostrService', () => ({
  pool: { querySync: (...a: unknown[]) => mockQuerySync(...a) },
}));
jest.mock('./identitiesStore', () => ({ loadIdentities: () => mockLoadIdentities() }));
jest.mock('./nostrRelayStorage', () => ({ getUserRelays: () => mockGetUserRelays() }));
jest.mock('./notificationService', () => ({
  fireMessageNotification: (...a: unknown[]) => mockFireMessageNotification(...a),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { runBackgroundSync } from './backgroundSyncService';

const ME = 'a'.repeat(64);
const READ_RELAYS = [{ url: 'wss://r.example', read: true, write: true }];

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockLoadIdentities.mockResolvedValue({ identities: [], activePubkey: ME });
  mockGetUserRelays.mockResolvedValue(READ_RELAYS);
  mockQuerySync.mockResolvedValue([]);
});

it('does nothing when logged out', async () => {
  mockLoadIdentities.mockResolvedValue({ identities: [], activePubkey: null });
  const r = await runBackgroundSync();
  expect(r).toEqual({ pinged: false, freshCount: 0 });
  expect(mockQuerySync).not.toHaveBeenCalled();
});

it('does nothing when there are no read relays', async () => {
  mockGetUserRelays.mockResolvedValue([{ url: 'wss://w', read: false, write: true }]);
  const r = await runBackgroundSync();
  expect(r.pinged).toBe(false);
  expect(mockQuerySync).not.toHaveBeenCalled();
});

it('pings when a fresh inbound gift-wrap is present', async () => {
  const now = Math.floor(Date.now() / 1000);
  mockQuerySync.mockResolvedValue([{ id: 'w1', kind: 1059, pubkey: 'ephemeral', created_at: now }]);
  const r = await runBackgroundSync();
  expect(r).toEqual({ pinged: true, freshCount: 1 });
  expect(mockFireMessageNotification).toHaveBeenCalledTimes(1);
  expect(mockFireMessageNotification.mock.calls[0][0]).toMatchObject({
    kind: 'dm',
    threadId: '__background__',
  });
  // Cursor advanced so the next run won't re-ping these.
  expect(await AsyncStorage.getItem('bg_sync_last_check_v1')).not.toBeNull();
});

it('ignores my own kind-4 echoes (no ping)', async () => {
  const now = Math.floor(Date.now() / 1000);
  mockQuerySync.mockResolvedValue([{ id: 'e1', kind: 4, pubkey: ME, created_at: now }]);
  const r = await runBackgroundSync();
  expect(r.pinged).toBe(false);
  expect(mockFireMessageNotification).not.toHaveBeenCalled();
});

it('does not ping when nothing new arrived', async () => {
  mockQuerySync.mockResolvedValue([]);
  const r = await runBackgroundSync();
  expect(r.pinged).toBe(false);
  expect(mockFireMessageNotification).not.toHaveBeenCalled();
});

it('does not re-ping events at/under the stored cursor', async () => {
  const cursor = Math.floor(Date.now() / 1000) - 10;
  await AsyncStorage.setItem('bg_sync_last_check_v1', String(cursor));
  // Event exactly at the cursor — already counted on a previous run.
  mockQuerySync.mockResolvedValue([{ id: 'w1', kind: 1059, pubkey: 'eph', created_at: cursor }]);
  const r = await runBackgroundSync();
  expect(r.pinged).toBe(false);
});
