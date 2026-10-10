import {
  isWatcherTaskPayload,
  showWatcherPushInForeground,
  watcherCategoryOf,
  watcherTapData,
} from './watcherPushReceive';

describe('watcherCategoryOf', () => {
  it('reads the data payload (Android, app running)', () => {
    expect(
      watcherCategoryOf({
        identifier: '0:123',
        content: { data: { source: 'lp-watcher', category: 'zap', kind: '9735' } },
      }),
    ).toBe('zap');
    // Watcher-sourced but an unknown category: not routable.
    expect(watcherCategoryOf({ content: { data: { source: 'lp-watcher', category: 'x' } } })).toBe(
      null,
    );
  });

  it("reads the OS-posted notification's tag (Android, backgrounded)", () => {
    expect(
      watcherCategoryOf({
        identifier: 'expo-notifications://foreign_notifications?tag=lp-payment&id=0',
        content: { data: { 'android.title': 'Lightning Piggy' } },
      }),
    ).toBe('payment');
  });

  it('reads the thread id / collapse id (iOS, data is null)', () => {
    expect(
      watcherCategoryOf({ identifier: 'ABC', content: { data: null, threadIdentifier: 'lp-dm' } }),
    ).toBe('dm');
    expect(watcherCategoryOf({ identifier: 'lp-mention', content: { data: null } })).toBe(
      'mention',
    );
  });

  it("ignores the app's own and Marmot notifications", () => {
    expect(watcherCategoryOf({ identifier: 'lp-bg-dm-foreground', content: { data: {} } })).toBe(
      null,
    );
    expect(
      watcherCategoryOf({
        identifier: 'uuid',
        content: { data: { kind: 'dm', marmotPush: true } },
      }),
    ).toBe(null);
    expect(
      watcherCategoryOf({ identifier: 'x', content: { data: null, threadIdentifier: '' } }),
    ).toBe(null);
    expect(watcherCategoryOf(null)).toBe(null);
  });
});

describe('isWatcherTaskPayload', () => {
  it('recognises a received watcher push (Android + iOS task shapes)', () => {
    expect(isWatcherTaskPayload({ data: { source: 'lp-watcher', category: 'dm' } })).toBe(true);
    expect(isWatcherTaskPayload({ source: 'lp-watcher' })).toBe(true);
  });

  it('recognises a tap on a watcher alert', () => {
    expect(
      isWatcherTaskPayload({
        actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
        notification: { request: { identifier: 'x', content: { threadIdentifier: 'lp-zap' } } },
      }),
    ).toBe(true);
  });

  it('lets a Marmot (Transponder) wake through', () => {
    expect(isWatcherTaskPayload({ data: { dataString: null }, notification: null })).toBe(false);
    expect(isWatcherTaskPayload(undefined)).toBe(false);
  });
});

describe('foreground + tap policy', () => {
  it('only mentions show while the app is open', () => {
    expect(showWatcherPushInForeground('mention')).toBe(true);
    expect(showWatcherPushInForeground('dm')).toBe(false);
    expect(showWatcherPushInForeground('zap')).toBe(false);
    expect(showWatcherPushInForeground('payment')).toBe(false);
  });

  it('routes messages to Messages, mentions to Notifications, money to Home', () => {
    expect(watcherTapData('dm')).toEqual({ kind: 'dm' });
    expect(watcherTapData('mention')).toEqual({ kind: 'mention' });
    expect(watcherTapData('zap')).toEqual({ kind: 'payment' });
    expect(watcherTapData('payment')).toEqual({ kind: 'payment' });
  });
});
