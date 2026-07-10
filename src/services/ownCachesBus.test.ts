import { notifyOwnCachesChanged, subscribeOwnCachesChanged } from './ownCachesBus';

describe('ownCachesBus — own-cache change pub/sub (#1016)', () => {
  it('notifies subscribers and stops after unsubscribe', () => {
    let calls = 0;
    const unsub = subscribeOwnCachesChanged(() => calls++);
    notifyOwnCachesChanged();
    expect(calls).toBe(1);
    unsub();
    notifyOwnCachesChanged();
    expect(calls).toBe(1);
  });

  it('isolates a throwing listener from the others', () => {
    let calls = 0;
    const unsubBad = subscribeOwnCachesChanged(() => {
      throw new Error('boom');
    });
    const unsubGood = subscribeOwnCachesChanged(() => calls++);
    expect(() => notifyOwnCachesChanged()).not.toThrow();
    expect(calls).toBe(1);
    unsubBad();
    unsubGood();
  });
});
