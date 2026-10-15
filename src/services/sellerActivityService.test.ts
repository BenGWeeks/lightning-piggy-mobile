import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Event } from 'nostr-tools';
import {
  checkSellerActivity,
  cancelSellerActivity,
  resolveActivityListing,
} from './sellerActivityService';
import { querySyncAbortable } from './relayQuery';
import { fetchSellerEvents } from './marketSellerService';
import { shouldMuteNotification } from './mutedSenders';
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
jest.mock('./mutedSenders', () => ({ shouldMuteNotification: jest.fn(async () => false) }));
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

it('drains capped pages including timestamp ties before advancing the checkpoint', async () => {
  const events = Array.from({ length: 201 }, (_, i) => ({
    ...comment(`busy-${i}`),
    created_at: now - 1000 - Math.floor(i / 2),
  }));
  await AsyncStorage.setItem(
    cursorKey,
    JSON.stringify({ lastSeen: now - 2000, seen: [], strangers: {} }),
  );
  jest
    .mocked(querySyncAbortable)
    .mockImplementation(async (_p, _r, f) =>
      f['#A']
        ? events
            .filter((e) => e.created_at >= f.since! && e.created_at <= f.until!)
            .slice(0, f.limit)
        : [],
    );
  await checkSellerActivity(opts());
  expect(fireNotification).toHaveBeenCalledTimes(201);
  expect(fireNotification).toHaveBeenCalledWith(
    expect.objectContaining({ historyKey: 'market:busy-200' }),
  );
  expect(JSON.parse((await AsyncStorage.getItem(cursorKey))!).lastSeen).toBeGreaterThanOrEqual(now);
});

it('retains the checkpoint when a timestamp is saturated instead of skipping older activity', async () => {
  await AsyncStorage.setItem(
    cursorKey,
    JSON.stringify({ lastSeen: now - 2000, seen: [], strangers: {} }),
  );
  jest.mocked(querySyncAbortable).mockImplementation(async (_p, _r, f) =>
    f['#A']
      ? Array.from({ length: 200 }, (_, i) => ({
          ...comment(`same-${i}`),
          created_at: now - 500,
        }))
      : [],
  );
  await expect(checkSellerActivity(opts())).rejects.toThrow('range remains saturated');
  expect(JSON.parse((await AsyncStorage.getItem(cursorKey))!).lastSeen).toBe(now - 2000);
  expect(querySyncAbortable).toHaveBeenCalledTimes(4);
});

it('retries an event interrupted during mute lookup without consuming its stranger quota', async () => {
  let release!: (muted: boolean) => void;
  jest.mocked(shouldMuteNotification).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  jest
    .mocked(querySyncAbortable)
    .mockImplementation(async (_p, _r, f) => (f['#A'] ? [comment('interrupted', stranger)] : []));
  const controller = new AbortController();
  const pending = checkSellerActivity({ ...opts(), signal: controller.signal });
  while (!release) await Promise.resolve();
  controller.abort();
  release(false);
  await pending;
  expect(fireNotification).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(cursorKey)).toBeNull();
  await checkSellerActivity(opts());
  expect(fireNotification).toHaveBeenCalledTimes(1);
  const cursor = JSON.parse((await AsyncStorage.getItem(cursorKey))!);
  expect(cursor.seen).toContain('interrupted');
  expect(Object.values(cursor.strangers)).toEqual([1]);
});

it('does not commit an event whose history delivery rejects', async () => {
  jest
    .mocked(querySyncAbortable)
    .mockImplementation(async (_p, _r, f) => (f['#A'] ? [comment('retry')] : []));
  jest.mocked(fireNotification).mockRejectedValueOnce(new Error('history failed'));
  await expect(checkSellerActivity(opts())).rejects.toThrow('history failed');
  expect(await AsyncStorage.getItem(cursorKey)).toBeNull();
  await checkSellerActivity(opts());
  expect(fireNotification).toHaveBeenCalledTimes(2);
});

it('drains a busy relay without skipping its tail when another relay returns older activity', async () => {
  const recent = Array.from({ length: 250 }, (_, i) => ({
    ...comment(`recent-${i}`),
    created_at: now - 1000 - i,
  }));
  const older = { ...comment('sparse-relay'), created_at: now - 1500 };
  await AsyncStorage.setItem(
    cursorKey,
    JSON.stringify({ lastSeen: now - 2000, seen: [], strangers: {} }),
  );
  jest.mocked(querySyncAbortable).mockImplementation(async (_p, relays, f) => {
    if (!f['#A']) return [];
    expect(relays).toEqual(['wss://busy', 'wss://sparse']);
    const matches = (event: Event) => event.created_at >= f.since! && event.created_at <= f.until!;
    // querySyncAbortable returns the deduplicated union, not a global limit.
    // Put the sparse relay first to also exercise unordered arrival.
    return [older].filter(matches).concat(recent.filter(matches).slice(0, f.limit));
  });
  await checkSellerActivity({ ...opts(), relays: ['wss://busy', 'wss://sparse'] });
  expect(fireNotification).toHaveBeenCalledTimes(251);
  expect(fireNotification).toHaveBeenCalledWith(
    expect.objectContaining({ historyKey: 'market:recent-249' }),
  );
  expect(fireNotification).toHaveBeenCalledWith(
    expect.objectContaining({ historyKey: 'market:sparse-relay' }),
  );
  expect(JSON.parse((await AsyncStorage.getItem(cursorKey))!).lastSeen).toBeGreaterThanOrEqual(now);
});

it('continues reviews, later coordinate chunks and replies after a saturated filter, then retries it', async () => {
  const listings = Array.from({ length: 26 }, (_, i) => ({
    ...listing,
    id: `listing-${i}`,
    tags: listing.tags.map((tag) => (tag[0] === 'd' ? ['d', `thing-${i}`] : tag)),
  }));
  jest.mocked(fetchSellerEvents).mockResolvedValue(listings);
  const parent = {
    ...comment('old-parent', owner),
    created_at: now - 86400 * 365,
    tags: buildCommentTags({ ...listing, pubkey: friend }),
  };
  const reply = {
    ...comment('independent-reply'),
    tags: buildCommentTags({ ...listing, pubkey: friend }, parent),
  };
  const review = {
    ...comment('independent-review'),
    kind: 31555,
    tags: [
      ['d', `a:30402:${owner}:thing-0`],
      ['rating', '0.8', 'thumb'],
    ],
  };
  const later = { ...comment('later-chunk'), tags: buildCommentTags(listings[25]) };
  const saturated = Array.from({ length: 200 }, (_, i) => ({
    ...comment(`saturated-${i}`),
    created_at: now - 500,
    tags: buildCommentTags(listings[0]),
  }));
  await AsyncStorage.setItem(
    cursorKey,
    JSON.stringify({ lastSeen: now - 2000, seen: [], strangers: {} }),
  );
  jest.mocked(querySyncAbortable).mockImplementation(async (_p, _r, f) => {
    if (f.ids) return [parent];
    if (f['#p']) return [reply];
    if (f['#d']?.includes(`a:30402:${owner}:thing-0`)) return [review];
    if (f['#A']?.includes(`30402:${owner}:thing-0`)) return saturated;
    if (f['#A']) return [later];
    return [];
  });
  await expect(checkSellerActivity(opts())).rejects.toThrow('range remains saturated');
  for (const id of ['independent-review', 'later-chunk', 'independent-reply']) {
    expect(fireNotification).toHaveBeenCalledWith(
      expect.objectContaining({ historyKey: `market:${id}` }),
    );
  }
  const cursor = JSON.parse((await AsyncStorage.getItem(cursorKey))!);
  expect(cursor.lastSeen).toBe(now - 2000);
  expect(cursor.seen).toEqual(
    expect.arrayContaining(['independent-review', 'later-chunk', 'independent-reply']),
  );
  const delivered = jest.mocked(fireNotification).mock.calls.length;
  // Once the busy range can drain, retry without redelivering successful work.
  saturated.pop();
  await checkSellerActivity(opts());
  expect(fireNotification).toHaveBeenCalledTimes(delivered);
  expect(JSON.parse((await AsyncStorage.getItem(cursorKey))!).lastSeen).toBeGreaterThanOrEqual(now);
});
