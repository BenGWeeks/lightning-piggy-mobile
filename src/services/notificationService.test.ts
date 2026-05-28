// Tests for the notification trigger logic (#279): foreground-suppression,
// payload assembly, and the lock-screen privacy substitution. The native
// expo-notifications module is mocked so we can assert exactly what content
// would be scheduled without a device.

const mockScheduleNotificationAsync = jest.fn().mockResolvedValue('notif-id');

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { SECRET: -1, PRIVATE: 0, PUBLIC: 1 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  setNotificationsForeground,
  setActiveThread,
  setActiveCache,
  isThreadActivelyViewed,
  isCacheActivelyViewed,
  fireMessageNotification,
  firePaymentNotification,
  fireCacheNotification,
  setLockScreenContentEnabled,
  __resetForTests,
} from './notificationService';

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
