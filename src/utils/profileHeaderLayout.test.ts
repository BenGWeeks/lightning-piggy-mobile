import { profileHeaderLayout } from './profileHeaderLayout';

describe('profileHeaderLayout', () => {
  it('uses the regular size on a wide phone at the default font scale', () => {
    const l = profileHeaderLayout(430, 1);
    expect(l.compact).toBe(false);
    expect(l.avatarSize).toBe(96);
    expect(l.iconSize).toBe(40);
  });

  it('goes compact on a ~400 dp phone or with a large system font', () => {
    expect(profileHeaderLayout(360, 1).compact).toBe(true);
    expect(profileHeaderLayout(411, 1.3).compact).toBe(true);
    expect(profileHeaderLayout(430, 1.6).compact).toBe(true);
  });

  it('keeps the action row inside the strip below the banner', () => {
    for (const width of [320, 360, 411, 430, 800]) {
      const l = profileHeaderLayout(width, 1);
      expect(l.overlap + l.actionStripHeight).toBe(l.avatarOuter);
      // The buttons fit in the strip, so they never poke up into the banner.
      expect(l.iconSize).toBeLessThanOrEqual(l.actionStripHeight);
    }
  });

  it('fits the compact row on a 360 dp phone at the default font scale', () => {
    const l = profileHeaderLayout(360, 1);
    expect(l.actionRowWidth).toBeLessThanOrEqual(l.availableWidth);
  });

  it('stays regular when there is no Follow pill (own / phone contact)', () => {
    expect(profileHeaderLayout(411, 1, 3, false).compact).toBe(false);
  });
});
