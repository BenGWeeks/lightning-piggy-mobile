import { claimWrapNotification, __resetForTests } from './dmWrapNotificationDedupe';

beforeEach(() => __resetForTests());

describe('claimWrapNotification', () => {
  it('grants the first claim and refuses the second for the same wrap id', () => {
    expect(claimWrapNotification('wrap-1')).toBe(true);
    expect(claimWrapNotification('wrap-1')).toBe(false);
  });

  it('treats distinct wrap ids independently', () => {
    expect(claimWrapNotification('wrap-a')).toBe(true);
    expect(claimWrapNotification('wrap-b')).toBe(true);
  });

  it('always grants for a missing id (never blocks a notification on bad data)', () => {
    expect(claimWrapNotification(undefined)).toBe(true);
    expect(claimWrapNotification(null)).toBe(true);
    expect(claimWrapNotification('')).toBe(true);
  });

  it('evicts oldest entries once the table is full, keeping recent claims intact', () => {
    for (let i = 0; i < 600; i++) claimWrapNotification(`wrap-${i}`);
    // The most recent claim is still held...
    expect(claimWrapNotification('wrap-599')).toBe(false);
    // ...while the oldest was evicted and can be re-claimed.
    expect(claimWrapNotification('wrap-0')).toBe(true);
  });
});
