// Tests for the detect-and-ping background sync (#279). The relay pool,
// identity/relay storage, and notificationService are mocked so we assert
// the detection + dedupe logic without network or native modules.

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
const SEEN_KEY = 'bg_sync_seen_ids_v1';

/** Put the service into the "primed" state (baseline established) with an
 * optional set of already-seen ids. Without this a run is the first-ever
 * run and stays silent. */
async function prime(ids: string[] = []): Promise<void> {
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(ids));
}

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

it('first-ever run primes the baseline silently (no ping) and seeds the seen-set', async () => {
  const now = Math.floor(Date.now() / 1000);
  mockQuerySync.mockResolvedValue([{ id: 'w1', kind: 1059, pubkey: 'eph', created_at: now }]);
  const r = await runBackgroundSync();
  expect(r).toEqual({ pinged: false, freshCount: 0 });
  expect(mockFireMessageNotification).not.toHaveBeenCalled();
  // The wrap we saw is now recorded so it won't ping on a later run.
  const seen = JSON.parse((await AsyncStorage.getItem(SEEN_KEY)) ?? '[]');
  expect(seen).toContain('w1');
});

it('pings when a new gift-wrap arrives after the baseline is primed', async () => {
  await prime(['old']);
  const now = Math.floor(Date.now() / 1000);
  mockQuerySync.mockResolvedValue([{ id: 'w1', kind: 1059, pubkey: 'eph', created_at: now }]);
  const r = await runBackgroundSync();
  expect(r).toEqual({ pinged: true, freshCount: 1 });
  expect(mockFireMessageNotification).toHaveBeenCalledTimes(1);
  expect(mockFireMessageNotification.mock.calls[0][0]).toMatchObject({
    kind: 'dm',
    threadId: '__background__',
  });
});

it('detects a backdated new wrap a since/created_at gate would miss (NIP-59)', async () => {
  await prime(['old']);
  const now = Math.floor(Date.now() / 1000);
  // NIP-59 randomises created_at up to 2 days back: a genuinely-new wrap can
  // carry a day-old timestamp. ID-dedup still catches it; a created_at gate
  // would not.
  mockQuerySync.mockResolvedValue([
    { id: 'wBack', kind: 1059, pubkey: 'eph', created_at: now - 24 * 60 * 60 },
  ]);
  const r = await runBackgroundSync();
  expect(r).toEqual({ pinged: true, freshCount: 1 });
});

it('queries a window wide enough to span the NIP-59 backdate (>= 2 days)', async () => {
  await prime([]);
  const now = Math.floor(Date.now() / 1000);
  await runBackgroundSync();
  const sinceArg = (mockQuerySync.mock.calls[0][1] as { since: number }).since;
  expect(now - sinceArg).toBeGreaterThanOrEqual(2 * 24 * 60 * 60);
});

it('ignores my own kind-4 echoes (no ping)', async () => {
  await prime(['old']);
  const now = Math.floor(Date.now() / 1000);
  mockQuerySync.mockResolvedValue([{ id: 'e1', kind: 4, pubkey: ME, created_at: now }]);
  const r = await runBackgroundSync();
  expect(r.pinged).toBe(false);
  expect(mockFireMessageNotification).not.toHaveBeenCalled();
});

it('does not re-ping a wrap whose id is already seen', async () => {
  await prime(['w1']);
  const now = Math.floor(Date.now() / 1000);
  mockQuerySync.mockResolvedValue([{ id: 'w1', kind: 1059, pubkey: 'eph', created_at: now }]);
  const r = await runBackgroundSync();
  expect(r.pinged).toBe(false);
  expect(mockFireMessageNotification).not.toHaveBeenCalled();
});

it('does not ping when nothing new arrived', async () => {
  await prime(['old']);
  mockQuerySync.mockResolvedValue([]);
  const r = await runBackgroundSync();
  expect(r.pinged).toBe(false);
  expect(mockFireMessageNotification).not.toHaveBeenCalled();
});
