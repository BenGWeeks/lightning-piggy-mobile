import { profileHeaderLayout, profileStickyPhase } from './profileHeaderLayout';

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

describe('profileStickyPhase', () => {
  const inset = 24; // status bar; the bar bottom is then 24 + 52 = 76
  it('shows nothing while the banner is under the buttons', () => {
    expect(profileStickyPhase(0, inset, 500)).toBe(0);
    expect(profileStickyPhase(-40, inset, 500)).toBe(0); // pull-to-refresh
    expect(profileStickyPhase(123, inset, 500)).toBe(0);
  });

  it('shows the solid bar once the banner has scrolled away', () => {
    expect(profileStickyPhase(124, inset, 500)).toBe(1);
    expect(profileStickyPhase(400, inset, null)).toBe(1);
  });

  it('pins the tabs when they reach the bar, accounting for a tall cutout', () => {
    expect(profileStickyPhase(424, inset, 500)).toBe(2);
    expect(profileStickyPhase(423, inset, 500)).toBe(1);
    // A 48 dp cutout inset pins the tabs 24 dp earlier.
    expect(profileStickyPhase(400, 48, 500)).toBe(2);
  });
});
