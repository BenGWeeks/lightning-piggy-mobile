import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Event } from 'nostr-tools';
import {
  checkSellerActivity,
  cancelSellerActivity,
  resolveActivityListing,
} from './sellerActivityService';
import { querySyncAbortable } from './relayQuery';
import { fetchSellerEvents } from './marketSellerService';
import { fireNotification } from './notificationService';
import { setSellerActivityEnabled } from './sellerActivityPreference';
import { buildCommentTags } from '../utils/productComments';
import i18n from '../i18n';
const owner = 'a'.repeat(64);
const friend = 'b'.repeat(64);
const stranger = 'c'.repeat(64);
let mockOwner: string | null = owner;
jest.mock('./walletStorageService', () => ({ getActivePubkey: () => mockOwner }));
jest.mock('./nostrPool', () => ({ pool: {}, trackRelays: jest.fn() }));
jest.mock('./relayQuery', () => ({ querySyncAbortable: jest.fn() }));
jest.mock('./marketSellerService', () => ({
  fetchSellerEvents: jest.fn(),
  loadHiddenListings: jest.fn(async () => new Map()),
}));
jest.mock('./notificationService', () => ({ fireNotification: jest.fn(async () => null) }));
jest.mock('../contexts/nostrDecryptPacing', () => ({
  createYieldScheduler: () => ({ maybeYield: async () => {}, dispose: () => {} }),
}));
const now = Math.floor(Date.now() / 1000);
const listing: Event = {
  id: 'listing',
  kind: 30402,
  pubkey: owner,
  created_at: now - 10000,
  tags: [
    ['d', 'thing'],
    ['title', 'Piggy'],
    ['price', '20', 'SATS'],
  ],
  content: '',
  sig: '',
};
const comment = (id: string, pubkey = friend): Event => ({
  id,
  pubkey,
  kind: 1111,
  created_at: now,
  tags: buildCommentTags(listing),
  content: '',
  sig: '',
});
const opts = () => ({
  owner,
  relays: ['wss://test'],
  friends: new Map([[friend, 'Friend']]),
  onlyFriends: true,
  t: (key: string, options?: object) => i18n.t(key, options),
  signal: new AbortController().signal,
});
const cursorKey = `seller_activity_cursor_v1_${owner}`;
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockOwner = owner;
  jest.mocked(fetchSellerEvents).mockResolvedValue([listing]);
  jest.mocked(querySyncAbortable).mockResolvedValue([]);
});
it('produces comment/review history targets, dedupes repeated checks and suppresses stranger alerts only', async () => {
  const review: Event = {
    ...comment('review', stranger),
    kind: 31555,
    tags: [
      ['d', `a:30402:${owner}:thing`],
      ['rating', '0.8', 'thumb'],
    ],
  };
  jest
    .mocked(querySyncAbortable)
    .mockImplementation(async (_pool, _relays, filter) =>
      filter['#A'] ? [comment('comment')] : filter['#d'] ? [review] : [],
    );
  await checkSellerActivity(opts());
  expect(fireNotification).toHaveBeenCalledTimes(2);
  const calls = jest.mocked(fireNotification).mock.calls.map(([p]) => p);
  expect(calls[0]).toMatchObject({
    title: 'New comment on Piggy',
    historyKey: 'market:comment',
    data: { listingCoord: `30402:${owner}:thing`, feedbackTab: 'comments', owner },
  });
  expect(calls[1]).toMatchObject({
    title: 'New review on Piggy ★4',
    data: { feedbackTab: 'reviews' },
  });
  expect(await calls[0].shouldSuppress?.()).toBe(false);
  expect(await calls[1].shouldSuppress?.()).toBe(true);
  await checkSellerActivity(opts());
  expect(fireNotification).toHaveBeenCalledTimes(2);
  expect(JSON.parse((await AsyncStorage.getItem(cursorKey))!).lastSeen).toBeGreaterThanOrEqual(now);
});
it('discovers a seller reply to an old comment on another listing via its actual parent', async () => {
  jest.mocked(fetchSellerEvents).mockResolvedValue([]);
  const otherListing = { ...listing, pubkey: friend };
  const parent = {
    ...comment('parent', owner),
    created_at: now - 86400 * 365,
    tags: buildCommentTags(otherListing),
  };
  const reply = { ...comment('reply'), tags: buildCommentTags(otherListing, parent) };
  jest
    .mocked(querySyncAbortable)
    .mockImplementation(async (_p, _r, filter) =>
      filter.ids ? [parent] : filter['#p'] ? [reply] : [],
    );
  await checkSellerActivity(opts());
  expect(fireNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Seller replied',
      data: expect.objectContaining({
        listingCoord: `30402:${friend}:thing`,
        feedbackTab: 'comments',
      }),
    }),
  );
  expect(
    jest
      .mocked(querySyncAbortable)
      .mock.calls.some(
        ([, , f]) => f.ids?.includes('parent') && f.since === 0 && f.authors?.includes(owner),
      ),
  ).toBe(true);
});
it('retains history while the setting is off, rejects forged recipients, and rechecks toggles before delivery', async () => {
  jest
    .mocked(querySyncAbortable)
    .mockImplementation(async (_p, _r, f) => (f['#A'] ? [comment('comment')] : []));
  await checkSellerActivity(opts());
  const payload = jest.mocked(fireNotification).mock.calls[0][0];
  await setSellerActivityEnabled(owner, false);
  expect(await payload.shouldSuppress?.()).toBe(true);
  jest.mocked(fetchSellerEvents).mockResolvedValue([]);
  jest.mocked(querySyncAbortable).mockImplementation(async (_p, _r, f) =>
    f['#p']
      ? [
          {
            ...comment('forged'),
            tags: [
              ...buildCommentTags({ ...listing, pubkey: stranger }),
              ['e', 'fake'],
              ['p', owner],
            ],
          },
        ]
      : [],
  );
  await checkSellerActivity(opts());
  expect(fireNotification).toHaveBeenCalledTimes(1);
});
it('does not advance last-seen on relay failure or an account switch', async () => {
  await AsyncStorage.setItem(
    cursorKey,
    JSON.stringify({ lastSeen: now - 60, seen: [], strangers: {} }),
  );
  jest.mocked(querySyncAbortable).mockRejectedValueOnce(new Error('offline'));
  await expect(checkSellerActivity(opts())).rejects.toThrow('offline');
  expect(JSON.parse((await AsyncStorage.getItem(cursorKey))!).lastSeen).toBe(now - 60);
  jest.mocked(querySyncAbortable).mockImplementation(async () => {
    mockOwner = stranger;
    return [comment('late')];
  });
  await checkSellerActivity(opts());
  expect(fireNotification).not.toHaveBeenCalled();
  expect(JSON.parse((await AsyncStorage.getItem(cursorKey))!).lastSeen).toBe(now - 60);
});
it('cancels an in-flight check before account removal and waits for it to settle', async () => {
  let release!: (events: Event[]) => void;
  jest.mocked(fetchSellerEvents).mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const pending = checkSellerActivity(opts());
  // Let storage hydration reach the relay snapshot.
  while (!release) await Promise.resolve();
  const cancelled = cancelSellerActivity(owner);
  release([listing]);
  await Promise.all([pending, cancelled]);
  expect(await AsyncStorage.getItem(cursorKey)).toBeNull();
  expect(fireNotification).not.toHaveBeenCalled();
});
it('resolves the correct latest listing only after a tap, preserving colon-containing identifiers', async () => {
  jest.mocked(querySyncAbortable).mockResolvedValue([
    {
      ...listing,
      tags: [
        ['d', 'thing:two'],
        ['title', 'Current'],
        ['price', '20', 'SATS'],
      ],
    },
  ]);
  const product = await resolveActivityListing(
    `30402:${owner}:thing:two`,
    ['wss://test'],
    new AbortController().signal,
  );
  expect(product?.title).toBe('Current');
  expect(await resolveActivityListing('invalid', [], new AbortController().signal)).toBeNull();
});

it('persists consumed stranger quotas when a later relay chunk fails, without advancing last-seen', async () => {
  await AsyncStorage.setItem(
    cursorKey,
    JSON.stringify({ lastSeen: now - 60, seen: [], strangers: {} }),
  );
  jest.mocked(querySyncAbortable).mockImplementation(async (_p, _r, f) => {
    if (f['#A']) return Array.from({ length: 20 }, (_, i) => comment(`spam${i}`, stranger));
    throw new Error('later chunk offline');
  });
  await expect(checkSellerActivity(opts())).rejects.toThrow('later chunk offline');
  expect(fireNotification).toHaveBeenCalledTimes(20);
  expect(JSON.parse((await AsyncStorage.getItem(cursorKey))!).lastSeen).toBe(now - 60);
  jest
    .mocked(querySyncAbortable)
    .mockImplementation(async (_p, _r, f) => (f['#A'] ? [comment('more spam', stranger)] : []));
  await checkSellerActivity(opts());
  expect(fireNotification).toHaveBeenCalledTimes(20);
});
