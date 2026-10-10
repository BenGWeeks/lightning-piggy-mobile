// Tests for the notification trigger logic (#279): foreground-suppression,
// payload assembly, and the lock-screen privacy substitution. The native
// expo-notifications module is mocked so we can assert exactly what content
// would be scheduled without a device.

const mockScheduleNotificationAsync = jest.fn().mockResolvedValue('notif-id');
const mockGetPresented = jest.fn().mockResolvedValue([]);
const mockDismiss = jest.fn().mockResolvedValue(undefined);
const mockGetScheduled = jest.fn().mockResolvedValue([]);
const mockCancel = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
  getPresentedNotificationsAsync: () => mockGetPresented(),
  dismissNotificationAsync: (id: string) => mockDismiss(id),
  getAllScheduledNotificationsAsync: () => mockGetScheduled(),
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { SECRET: -1, PRIVATE: 0, PUBLIC: 1 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { listNotifications } from './notificationHistory';
import {
  setNotificationsForeground,
  setActiveThread,
  setActiveCache,
  isThreadActivelyViewed,
  isCacheActivelyViewed,
  fireMessageNotification,
  firePaymentNotification,
  fireCacheNotification,
  fireNotification,
  ensureNotificationsInitialised,
  setLockScreenContentEnabled,
  __resetForTests,
  notificationMatchesTarget,
  dismissNotificationsFor,
  FOREGROUND_SERVICE_NOTIFICATION_ID,
  markHistoryReadFor,
  markHistoryEntryRead,
  isRemotePush,
  lastMarmotNotificationAt,
} from './notificationService';
import { setActivePubkeyForWalletStorage } from './walletStorageService';

const lastScheduledContent = () => mockScheduleNotificationAsync.mock.calls.at(-1)?.[0]?.content;

beforeEach(async () => {
  mockScheduleNotificationAsync.mockClear();
  await AsyncStorage.clear();
  __resetForTests();
});

describe('foreground suppression', () => {
  it('is active only when foreground AND the thread matches', () => {
    setNotificationsForeground(true);
    setActiveThread('peer-abc');
    expect(isThreadActivelyViewed('peer-abc')).toBe(true);
    expect(isThreadActivelyViewed('peer-xyz')).toBe(false);
  });

  it('is never active while backgrounded, even on the open thread', () => {
    setActiveThread('peer-abc');
    setNotificationsForeground(false);
    expect(isThreadActivelyViewed('peer-abc')).toBe(false);
  });

  it('clears when the active thread is unset (screen blur)', () => {
    setNotificationsForeground(true);
    setActiveThread('peer-abc');
    setActiveThread(null);
    expect(isThreadActivelyViewed('peer-abc')).toBe(false);
  });
});

describe('fireMessageNotification', () => {
  it('suppresses (no schedule) when the user is viewing that exact thread', async () => {
    setNotificationsForeground(true);
    setActiveThread('peer-abc');
    const id = await fireMessageNotification({
      kind: 'dm',
      threadId: 'peer-abc',
      title: 'Alice',
      body: 'hello',
      data: { conversationPubkey: 'peer-abc' },
    });
    expect(id).toBeNull();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('fires for a different thread than the one being viewed', async () => {
    setNotificationsForeground(true);
    setActiveThread('peer-abc');
    await fireMessageNotification({
      kind: 'dm',
      threadId: 'peer-other',
      title: 'Bob',
      body: 'yo',
      data: { conversationPubkey: 'peer-other' },
    });
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    // kind always rides in data for the tap-router.
    expect(lastScheduledContent()?.data).toMatchObject({
      kind: 'dm',
      conversationPubkey: 'peer-other',
    });
  });
});

describe('lock-screen privacy substitution', () => {
  it('hides the body/title by default (content disabled)', async () => {
    await fireMessageNotification({
      kind: 'dm',
      threadId: 'peer-abc',
      title: 'Alice',
      body: 'secret plaintext',
      data: { conversationPubkey: 'peer-abc' },
    });
    const content = lastScheduledContent();
    expect(content?.title).toBe('New message');
    expect(content?.body).not.toContain('secret plaintext');
    // The real payload still rides in data for the in-app screen post-unlock.
    expect(content?.data).toMatchObject({ kind: 'dm', conversationPubkey: 'peer-abc' });
  });

  it('shows the real title/body once the user opts in', async () => {
    await setLockScreenContentEnabled(true);
    await fireMessageNotification({
      kind: 'dm',
      threadId: 'peer-abc',
      title: 'Alice',
      body: 'secret plaintext',
      data: { conversationPubkey: 'peer-abc' },
    });
    const content = lastScheduledContent();
    expect(content?.title).toBe('Alice');
    expect(content?.body).toBe('secret plaintext');
  });
});

describe('firePaymentNotification', () => {
  beforeEach(async () => {
    // Opt into content so we can assert the real formatted body.
    await setLockScreenContentEnabled(true);
  });

  it('formats a plain payment (no comment)', async () => {
    await firePaymentNotification({ kind: 'payment', amountSats: 1000, walletId: 'w1' });
    const content = lastScheduledContent();
    expect(content?.title).toBe('Payment received');
    // Build the expected string with the same locale-aware formatter the
    // code uses, so the assertion doesn't break under a non-en CI locale.
    expect(content?.body).toBe(`+${(1000).toLocaleString()} sats received`);
    expect(content?.data).toMatchObject({ kind: 'payment', walletId: 'w1' });
  });

  it('formats a zap with a comment', async () => {
    await firePaymentNotification({ kind: 'zap', amountSats: 500, comment: 'gm ☀️' });
    const content = lastScheduledContent();
    expect(content?.title).toBe('Zap received');
    expect(content?.body).toBe('+500 sats · gm ☀️');
  });

  it('is never suppressed by the active-thread gate', async () => {
    setNotificationsForeground(true);
    setActiveThread('anything');
    const id = await firePaymentNotification({ kind: 'payment', amountSats: 42 });
    expect(id).toBe('notif-id');
    expect(mockScheduleNotificationAsync).toHaveBeenCalled();
  });

  it('marks a catch-up payment quiet (and leaves a live one unflagged)', async () => {
    await firePaymentNotification({ kind: 'zap', amountSats: 21, walletId: 'w1', quiet: true });
    expect(lastScheduledContent()?.data).toMatchObject({
      kind: 'zap',
      walletId: 'w1',
      quiet: true,
    });
    await firePaymentNotification({ kind: 'zap', amountSats: 21, walletId: 'w1' });
    expect(lastScheduledContent()?.data).not.toHaveProperty('quiet');
  });

  it('enforces quiet natively — no sound, passive on iOS — so it holds in the background', async () => {
    await firePaymentNotification({ kind: 'zap', amountSats: 21, walletId: 'w1', quiet: true });
    expect(lastScheduledContent()).toMatchObject({ sound: false, interruptionLevel: 'passive' });
    await firePaymentNotification({ kind: 'zap', amountSats: 21, walletId: 'w1' });
    expect(lastScheduledContent()?.sound).toBe('default');
    expect(lastScheduledContent()).not.toHaveProperty('interruptionLevel');
  });
});

describe('foreground presentation', () => {
  const present = async (data: Record<string, unknown>) => {
    await ensureNotificationsInitialised();
    const { handleNotification } = jest.mocked(Notifications.setNotificationHandler).mock
      .calls[0][0]!;
    return handleNotification({ request: { content: { data } } } as never);
  };

  it('pops a normal notification as a banner with sound', async () => {
    await expect(present({ kind: 'payment' })).resolves.toMatchObject({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
    });
  });

  it('puts a quiet one in the drawer only — no banner, no sound', async () => {
    await expect(present({ kind: 'zap', quiet: true })).resolves.toMatchObject({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
    });
  });
});

// --- Find-log notifications (#740) -----------------------------------

describe('active-cache suppression (#740)', () => {
  it('is active only when foreground AND the coord matches', () => {
    setNotificationsForeground(true);
    setActiveCache('37516:abc:my-cache');
    expect(isCacheActivelyViewed('37516:abc:my-cache')).toBe(true);
    expect(isCacheActivelyViewed('37516:abc:other-cache')).toBe(false);
  });

  it('is never active while backgrounded, even on the open cache', () => {
    setActiveCache('37516:abc:my-cache');
    setNotificationsForeground(false);
    expect(isCacheActivelyViewed('37516:abc:my-cache')).toBe(false);
  });

  it('clears when the active cache is unset (screen blur)', () => {
    setNotificationsForeground(true);
    setActiveCache('37516:abc:my-cache');
    setActiveCache(null);
    expect(isCacheActivelyViewed('37516:abc:my-cache')).toBe(false);
  });

  it('independent of the active-thread state (a coord matching a thread id does not suppress)', () => {
    setNotificationsForeground(true);
    setActiveThread('shared-id');
    expect(isCacheActivelyViewed('shared-id')).toBe(false);
    setActiveCache('shared-id');
    expect(isCacheActivelyViewed('shared-id')).toBe(true);
    expect(isThreadActivelyViewed('shared-id')).toBe(true);
  });
});

describe('fireCacheNotification', () => {
  it('suppresses (no schedule) when the user is viewing that exact cache', async () => {
    setNotificationsForeground(true);
    setActiveCache('37516:abc:my-cache');
    const id = await fireCacheNotification({
      cacheCoord: '37516:abc:my-cache',
      title: 'Find on My Cache',
      body: 'finderName found it',
    });
    expect(id).toBeNull();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('fires for a different cache than the one being viewed', async () => {
    setNotificationsForeground(true);
    setActiveCache('37516:abc:my-cache');
    await fireCacheNotification({
      cacheCoord: '37516:abc:other-cache',
      title: 'Find on Other Cache',
      body: 'someone found it',
    });
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    // kind always rides in data for the tap-router; coord is the payload.
    expect(lastScheduledContent()?.data).toMatchObject({
      kind: 'cache',
      cacheCoord: '37516:abc:other-cache',
    });
  });

  it('uses generic copy when the lock-screen-content toggle is off (default)', async () => {
    await fireCacheNotification({
      cacheCoord: '37516:abc:my-cache',
      title: 'Find on My Cache',
      body: 'finderName · "got it!"',
    });
    const content = lastScheduledContent();
    expect(content?.title).toBe('New find on your cache');
    expect(content?.body).toBe('Open Lightning Piggy to view');
    // The coord still rides in data for the tap router to pick up on
    // unlock — only the human-readable title/body is redacted.
    expect(content?.data).toMatchObject({ kind: 'cache', cacheCoord: '37516:abc:my-cache' });
  });

  it('redacts a swap-attention alert as "Action needed", never "Payment received" (#1124)', async () => {
    await fireNotification({
      kind: 'swap',
      title: 'Swap needs attention',
      body: 'A pending swap (5f3zBIcW…) with on-chain funds…',
    });
    const content = lastScheduledContent();
    expect(content?.title).toBe('Action needed');
    expect(content?.body).toBe('Open Lightning Piggy for details');
  });

  it('uses the real title/body once the user opts in', async () => {
    await setLockScreenContentEnabled(true);
    await fireCacheNotification({
      cacheCoord: '37516:abc:my-cache',
      title: 'Find on Treasure Pig',
      body: 'alice · "thanks!"',
    });
    const content = lastScheduledContent();
    expect(content?.title).toBe('Find on Treasure Pig');
    expect(content?.body).toBe('alice · "thanks!"');
  });

  it('background sentinel coord (__background__) never matches a real active cache', async () => {
    // Whatever the user is currently viewing, a background ping with the
    // sentinel must always get through (it never matches a real coord).
    setNotificationsForeground(true);
    setActiveCache('37516:abc:any-real-cache');
    const id = await fireCacheNotification({
      cacheCoord: '__background__',
      title: 'New find on your cache',
      body: 'Open Lightning Piggy to view',
    });
    expect(id).toBe('notif-id');
    expect(mockScheduleNotificationAsync).toHaveBeenCalled();
  });
});

describe('clearing read notifications (#1142)', () => {
  const PK = 'a'.repeat(64);
  const presented = (identifier: string, data: Record<string, unknown>) => ({
    request: { identifier, content: { data } },
  });

  it('matches a 1:1 thread by pubkey and protocol (missing protocol = NIP-17)', () => {
    const target = { conversationPubkey: PK, conversationProtocol: 'nip17' as const };
    expect(
      notificationMatchesTarget({ kind: 'dm', conversationPubkey: PK.toUpperCase() }, target),
    ).toBe(true);
    expect(
      notificationMatchesTarget(
        { kind: 'dm', conversationPubkey: PK, conversationProtocol: 'nip04' },
        target,
      ),
    ).toBe(false);
    expect(
      notificationMatchesTarget({ kind: 'dm', conversationPubkey: 'b'.repeat(64) }, target),
    ).toBe(false);
  });

  it('matches groups, cache find-logs and generic message pings separately', () => {
    expect(notificationMatchesTarget({ kind: 'group', groupId: 'g1' }, { groupId: 'g1' })).toBe(
      true,
    );
    expect(notificationMatchesTarget({ kind: 'group', groupId: 'g2' }, { groupId: 'g1' })).toBe(
      false,
    );
    expect(
      notificationMatchesTarget(
        { kind: 'cache', cacheCoord: '37516:x:y' },
        { cacheCoord: '37516:x:y' },
      ),
    ).toBe(true);
    const generic = { genericMessages: true as const };
    expect(notificationMatchesTarget({ kind: 'dm' }, generic)).toBe(true);
    expect(notificationMatchesTarget({ kind: 'group', groupId: 'g1' }, generic)).toBe(false);
    expect(notificationMatchesTarget({ kind: 'payment' }, generic)).toBe(false);
  });

  it("dismisses only the target's notifications, never the foreground-service one", async () => {
    mockGetPresented.mockResolvedValueOnce([
      presented('n1', { kind: 'group', groupId: 'g1' }),
      presented('n2', { kind: 'group', groupId: 'g2' }),
      presented('n3', { kind: 'payment' }),
      presented(FOREGROUND_SERVICE_NOTIFICATION_ID, { kind: 'dm' }),
    ]);
    expect(await dismissNotificationsFor({ groupId: 'g1' })).toBe(1);
    expect(mockDismiss.mock.calls).toEqual([['n1']]);

    mockDismiss.mockClear();
    mockGetPresented.mockResolvedValueOnce([
      presented('n4', { kind: 'dm' }),
      presented(FOREGROUND_SERVICE_NOTIFICATION_ID, { kind: 'dm' }),
    ]);
    expect(await dismissNotificationsFor({ genericMessages: true })).toBe(1);
    expect(mockDismiss.mock.calls).toEqual([['n4']]);
  });

  it('also cancels a matching notification still pending its 1 s trigger', async () => {
    mockDismiss.mockClear();
    mockGetScheduled.mockResolvedValueOnce([
      { identifier: 's1', content: { data: { kind: 'group', groupId: 'g1' } } },
      { identifier: 's2', content: { data: { kind: 'group', groupId: 'g2' } } },
    ]);
    expect(await dismissNotificationsFor({ groupId: 'g1' })).toBe(1);
    expect(mockCancel.mock.calls).toEqual([['s1']]);
  });

  it('is best-effort when the native call fails', async () => {
    mockGetPresented.mockRejectedValueOnce(new Error('native'));
    expect(await dismissNotificationsFor({ groupId: 'g1' })).toBe(0);
  });
});

describe('in-app history owner (#1143)', () => {
  it('records under the explicit owner when no account is loaded (headless run)', async () => {
    const owner = 'c'.repeat(64);
    await fireNotification({ kind: 'dm', title: 'Little Piggy', body: 'hi', owner });
    // recordNotification is fire-and-forget; listNotifications awaits its queue.
    const history = await listNotifications(owner);
    expect(history.map((e) => e.title)).toEqual(['Little Piggy']);
    expect(history[0].body).toBeUndefined();
  });
});

describe('keeping the history in step with the tray (#1143)', () => {
  it('links each tray notification to exactly its own history row', async () => {
    const owner = 'f'.repeat(64);
    setActivePubkeyForWalletStorage(owner);
    try {
      mockScheduleNotificationAsync.mockClear();
      // Two payments to one wallet: only distinguishable by their history ids.
      await firePaymentNotification({
        kind: 'payment',
        amountSats: 1,
        walletId: 'w',
        sourceId: 'h1',
      });
      await firePaymentNotification({
        kind: 'payment',
        amountSats: 2,
        walletId: 'w',
        sourceId: 'h2',
      });
      const ids = mockScheduleNotificationAsync.mock.calls.map((c) => c[0].content.data.historyId);
      const history = await listNotifications(owner);
      expect(new Set(ids)).toEqual(new Set(history.map((e) => e.id)));
      expect(new Set(ids).size).toBe(2);
      expect(
        notificationMatchesTarget({ kind: 'payment', historyId: ids[0] }, { historyId: ids[0] }),
      ).toBe(true);
      expect(
        notificationMatchesTarget({ kind: 'payment', historyId: ids[1] }, { historyId: ids[0] }),
      ).toBe(false);

      // Tapping the first tray notification marks only its row read.
      await markHistoryEntryRead(ids[0]);
      const after = await listNotifications(owner);
      expect(after.find((e) => e.id === ids[0])?.read).toBe(true);
      expect(after.find((e) => e.id === ids[1])?.read).toBe(false);
    } finally {
      setActivePubkeyForWalletStorage(null);
    }
  });

  it("marks the active account's matching history entries read when a screen shows them", async () => {
    const owner = 'd'.repeat(64);
    setActivePubkeyForWalletStorage(owner);
    try {
      await fireNotification({
        kind: 'group',
        title: 'Piggy Pals',
        body: 'x',
        data: { groupId: 'g1' },
      });
      await fireNotification({ kind: 'group', title: 'Other', body: 'y', data: { groupId: 'g2' } });
      await markHistoryReadFor({ groupId: 'g1' });
      const history = await listNotifications(owner);
      expect(history.find((e) => e.title === 'Piggy Pals')?.read).toBe(true);
      expect(history.find((e) => e.title === 'Other')?.read).toBe(false);
    } finally {
      setActivePubkeyForWalletStorage(null);
    }
  });
});

describe('account scoping and persistence (#1143)', () => {
  it('"Mark all read" matches only the given account\'s tray notifications', () => {
    const a = 'a'.repeat(64);
    expect(notificationMatchesTarget({ kind: 'dm', owner: a }, { owner: a })).toBe(true);
    expect(notificationMatchesTarget({ kind: 'dm', owner: 'b'.repeat(64) }, { owner: a })).toBe(
      false,
    );
    // Older notifications without an owner are left alone.
    expect(notificationMatchesTarget({ kind: 'dm' }, { owner: a })).toBe(false);
  });

  it('has persisted the history row by the time delivery resolves (headless runs)', async () => {
    const owner = '9'.repeat(64);
    // A slow storage write, as on a busy device: a detached write would still
    // be pending when delivery resolves.
    const realSetItem = AsyncStorage.setItem;
    AsyncStorage.setItem = (async (key: string, value: string) => {
      await new Promise((r) => setTimeout(r, 50));
      return realSetItem(key, value);
    }) as typeof AsyncStorage.setItem;
    try {
      await fireNotification({ kind: 'zap', title: 'Zap received', body: '+1 sats', owner });
    } finally {
      AsyncStorage.setItem = realSetItem;
    }
    // Read storage directly — not via listNotifications, which waits on the queue.
    const raw = await AsyncStorage.getItem(`notification_history_v1_${owner}`);
    expect(JSON.parse(raw ?? '[]')).toHaveLength(1);
    const scheduled = mockScheduleNotificationAsync.mock.calls.at(-1)?.[0]?.content?.data;
    expect(scheduled.owner).toBe(owner);
  });
});

describe('repeated sources in the tray (#1143)', () => {
  const owner = '8'.repeat(64);
  const payment = {
    kind: 'payment' as const,
    amountSats: 21,
    walletId: 'w',
    owner,
    sourceId: 'h-repeat',
  };

  it("doesn't post a second tray entry for a source already shown", async () => {
    mockScheduleNotificationAsync.mockClear();
    const first = await firePaymentNotification(payment);
    const second = await firePaymentNotification(payment);
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull(); // reported delivered, so callers stop retrying
  });

  it('still posts a retry whose first tray post failed', async () => {
    mockScheduleNotificationAsync.mockClear();
    const retry = { ...payment, sourceId: 'h-failed' };
    mockScheduleNotificationAsync.mockRejectedValueOnce(new Error('OS refused'));
    expect(await firePaymentNotification(retry)).toBeNull();
    expect(await firePaymentNotification(retry)).not.toBeNull();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
    const history = await listNotifications(owner);
    expect(history).toHaveLength(1); // one row despite the retry
    expect(history[0].delivered).toBe(true);
  });
});

describe('Marmot push (MIP-05) receive side', () => {
  const notification = (trigger: unknown) =>
    ({ request: { identifier: 'n', content: { data: {} }, trigger } }) as never;

  it('tells remote pushes apart from our own local notifications', () => {
    expect(isRemotePush(notification({ type: 'push' }))).toBe(true);
    expect(isRemotePush(notification({ type: 'timeInterval', seconds: 1 }))).toBe(false);
    expect(isRemotePush(notification(null))).toBe(false);
  });

  it("never shows Android's data-only push (the wake task owns the alert)", async () => {
    const { Platform } = jest.requireActual('react-native');
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    try {
      await ensureNotificationsInitialised();
      const handler = (Notifications.setNotificationHandler as jest.Mock).mock.calls.at(-1)?.[0];
      expect(await handler.handleNotification(notification({ type: 'push' }))).toMatchObject({
        shouldShowBanner: false,
        shouldPlaySound: false,
      });
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => original });
    }
  });

  it('in the foreground, hides a remote push only once the app has shown the message', async () => {
    await ensureNotificationsInitialised();
    const handler = (Notifications.setNotificationHandler as jest.Mock).mock.calls.at(-1)?.[0];
    jest.useFakeTimers();
    const pending = handler.handleNotification(notification({ type: 'push' }));
    await jest.advanceTimersByTimeAsync(2_000);
    // Nothing shown (e.g. another account's push) → the generic alert shows.
    expect(await pending).toMatchObject({ shouldShowBanner: true });
    jest.useRealTimers();
    // The open thread counts as shown.
    setNotificationsForeground(true);
    setActiveThread('marmot-thread');
    await fireMessageNotification({
      kind: 'dm',
      threadId: 'marmot-thread',
      title: 'Bob',
      body: 'hi',
      data: { conversationPubkey: 'p', conversationProtocol: 'marmot' },
    });
    expect(await handler.handleNotification(notification({ type: 'push' }))).toMatchObject({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
    });
    expect(await handler.handleNotification(notification(null))).toMatchObject({
      shouldShowBanner: true,
      shouldShowList: true,
    });
  });

  it('records when a Marmot message was shown — not NIP-17 ones or generic pings', async () => {
    setNotificationsForeground(false);
    await fireMessageNotification({
      kind: 'dm',
      threadId: '__push__',
      title: 'New message',
      body: 'x',
      data: { marmotPush: true },
    });
    await fireMessageNotification({
      kind: 'dm',
      threadId: 'peer',
      title: 'Alice',
      body: 'nip17',
      data: { conversationPubkey: 'peer', conversationProtocol: 'nip17' },
    });
    expect(lastMarmotNotificationAt()).toBe(0);
    const before = Date.now();
    await fireMessageNotification({
      kind: 'group',
      threadId: 'marmot:abc',
      title: 'Family',
      body: 'hi',
      data: { groupId: 'marmot:abc' },
    });
    expect(lastMarmotNotificationAt()).toBeGreaterThanOrEqual(before);
  });

  it('the real Marmot message clears the generic push alert', async () => {
    setNotificationsForeground(false);
    mockGetPresented.mockResolvedValueOnce([
      {
        request: {
          identifier: 'push-alert',
          content: { data: { kind: 'dm', marmotPush: true } },
          trigger: { type: 'timeInterval' },
        },
      },
      {
        request: {
          identifier: 'other-dm',
          content: { data: { kind: 'dm', conversationPubkey: 'x' } },
          trigger: { type: 'timeInterval' },
        },
      },
    ]);
    await fireMessageNotification({
      kind: 'dm',
      threadId: 'marmot-peer',
      title: 'Bob',
      body: 'hi',
      data: { conversationPubkey: 'peer', conversationProtocol: 'marmot' },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockDismiss).toHaveBeenCalledWith('push-alert');
    expect(mockDismiss).not.toHaveBeenCalledWith('other-dm');
  });

  it('opening Messages clears a data-less server alert (iOS)', async () => {
    mockDismiss.mockClear();
    mockGetPresented.mockResolvedValueOnce([
      { request: { identifier: 'apns-alert', content: { data: {} }, trigger: { type: 'push' } } },
    ]);
    expect(await dismissNotificationsFor({ genericMessages: true })).toBe(1);
    expect(mockDismiss).toHaveBeenCalledWith('apns-alert');
  });
});
