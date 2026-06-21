/**
 * Shape tests for the wallet card theme registry. Catches drift between
 * the `CardTheme` union and the `cardThemes` map (forgotten entries,
 * malformed gradients, ID/key mismatch). Added with the sports themes
 * in #102 so the new placeholder entries don't quietly regress.
 *
 * Real artwork is a designer follow-up — these tests intentionally
 * tolerate missing `backgroundImage` so the gradient-only sports cards
 * pass while still being part of the same registry the picker iterates.
 */

import { cardThemes, themeList } from './cardThemes';
import type { CardTheme } from '../types/wallet';

const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;

const SPORTS_THEMES: CardTheme[] = ['tennis', 'football', 'basketball', 'f1'];

describe('cardThemes registry', () => {
  it('keys each entry by its own id (no copy/paste drift)', () => {
    for (const [key, entry] of Object.entries(cardThemes)) {
      expect(entry.id).toBe(key);
    }
  });

  it('has the required fields on every entry', () => {
    for (const entry of themeList) {
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.gradientColors).toHaveLength(2);
      expect(entry.gradientColors[0]).toMatch(HEX_COLOUR);
      expect(entry.gradientColors[1]).toMatch(HEX_COLOUR);
      expect(entry.textColor).toMatch(HEX_COLOUR);
      expect(entry.accentColor).toMatch(HEX_COLOUR);
    }
  });

  it('exposes themeList in the same order as Object.values(cardThemes)', () => {
    expect(themeList.map((t) => t.id)).toEqual(Object.values(cardThemes).map((t) => t.id));
  });

  describe('sports themes (#102)', () => {
    it.each(SPORTS_THEMES)('registers %s with a name and gradient', (id) => {
      const theme = cardThemes[id];
      expect(theme).toBeDefined();
      expect(theme.name.length).toBeGreaterThan(0);
      expect(theme.gradientColors[0]).toMatch(HEX_COLOUR);
      expect(theme.gradientColors[1]).toMatch(HEX_COLOUR);
    });

    it('appears in themeList so the wizard + settings picker auto-include them', () => {
      const ids = themeList.map((t) => t.id);
      for (const sportId of SPORTS_THEMES) {
        expect(ids).toContain(sportId);
      }
    });

    it('does NOT register backgroundImage yet (placeholder gradients only)', () => {
      // Real art is a designer follow-up; if this fails, either the
      // asset has landed (great — delete this assertion) or someone
      // accidentally pointed a sports theme at the wrong PNG.
      for (const id of SPORTS_THEMES) {
        expect(cardThemes[id].backgroundImage).toBeUndefined();
      }
    });
  });
});
