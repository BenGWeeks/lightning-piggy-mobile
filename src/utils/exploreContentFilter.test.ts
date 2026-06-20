// Verify the build-aware composition: a Piggy pubkey is hidden ONLY when
// the build is production. Dev / preview must let it through (Maestro).

jest.mock('expo-application', () => ({
  get applicationId() {
    return mockApplicationId;
  },
}));

import { isHiddenInProd } from './exploreContentFilter';

let mockApplicationId: string | null = null;

const BIG_PIGGY = 'ccedbff9a6f261b388078b70225dfa4147efaab5f062a7722a0d253f0360c7e7';
const REAL_USER = '1111111111111111111111111111111111111111111111111111111111111111';

describe('isHiddenInProd', () => {
  afterEach(() => {
    mockApplicationId = null;
  });

  it('hides a Piggy test account in the production build', () => {
    mockApplicationId = 'com.lightningpiggy.app';
    expect(isHiddenInProd(BIG_PIGGY)).toBe(true);
  });

  it('does NOT hide a Piggy in the dev build', () => {
    mockApplicationId = 'com.lightningpiggy.app.dev';
    expect(isHiddenInProd(BIG_PIGGY)).toBe(false);
  });

  it('does NOT hide a Piggy in the preview build', () => {
    mockApplicationId = 'com.lightningpiggy.app.preview';
    expect(isHiddenInProd(BIG_PIGGY)).toBe(false);
  });

  it('never hides a real user, even in production', () => {
    mockApplicationId = 'com.lightningpiggy.app';
    expect(isHiddenInProd(REAL_USER)).toBe(false);
  });
});
