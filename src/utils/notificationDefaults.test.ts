import { resolveNotificationDefaults } from './notificationDefaults';

const fresh = { instant: null, more: null };

describe('notification defaults', () => {
  it('enables both for the first account', () => {
    expect(
      resolveNotificationDefaults({ preferences: fresh, otherAccountHasPreference: false }),
    ).toEqual({ instant: true, more: true });
  });
  it('leaves additional accounts opted out even when the other account chose OFF', () => {
    expect(
      resolveNotificationDefaults({ preferences: fresh, otherAccountHasPreference: true }),
    ).toEqual({ instant: false, more: false });
  });
  it.each([
    [
      { instant: false, more: null },
      { instant: false, more: true },
    ],
    [
      { instant: null, more: false },
      { instant: true, more: false },
    ],
    [
      { instant: false, more: false },
      { instant: false, more: false },
    ],
    [
      { instant: true, more: true },
      { instant: true, more: true },
    ],
  ])('preserves stored preferences %j', (preferences, expected) => {
    expect(resolveNotificationDefaults({ preferences, otherAccountHasPreference: false })).toEqual(
      expected,
    );
  });
  it('shows both off when permission is denied, including existing enabled accounts', () => {
    expect(
      resolveNotificationDefaults({
        preferences: { instant: true, more: true },
        otherAccountHasPreference: false,
        permissionDenied: true,
      }),
    ).toEqual({ instant: false, more: false });
  });
});
