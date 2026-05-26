// Contract guards around the WoT-settings persistence + migration paths.
// Two things matter strongly here and warrant being locked in by tests:
//   1. The first-run default (no stored payload) returns 'all' — this is
//      what makes new users see Geo-caches + Events on Explore / Hunt /
//      Events surfaces (issue #627).
//   2. The legacy boolean payload migrates correctly so users on pre-#535
//      installs don't have their explicit choice ignored.

import { loadWotSettings, saveWotSettings } from './wotSettingsService';

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
    setItem: jest.fn((k: string, v: string) => {
      store[k] = v;
      return Promise.resolve();
    }),
    removeItem: jest.fn((k: string) => {
      delete store[k];
      return Promise.resolve();
    }),
    // Test-only escape hatch — not part of AsyncStorage's API. Used to
    // reset the mock between tests without re-importing the module.
    __reset: () => {
      store = {};
    },
  };
});

const STORAGE_KEY = '@lp:wot-settings:v1';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AsyncStorage = require('@react-native-async-storage/async-storage');

beforeEach(() => {
  AsyncStorage.__reset();
});

describe('wotSettingsService', () => {
  describe('loadWotSettings — first-run default', () => {
    it("returns wotTier='all' when no payload is stored (issue #627)", async () => {
      // The empty-rail symptom on a fresh emulator install was directly
      // caused by this default being 'friends' before #627. Locking it
      // in here so an accidental revert shows up as a test failure
      // rather than as 'no caches load' user reports.
      const settings = await loadWotSettings();
      expect(settings.wotTier).toBe('all');
    });

    it('returns the same default on a corrupt JSON payload', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, '<not json>');
      const settings = await loadWotSettings();
      expect(settings.wotTier).toBe('all');
    });

    it('returns the same default on a payload missing wotTier', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ otherField: true }));
      const settings = await loadWotSettings();
      expect(settings.wotTier).toBe('all');
    });
  });

  describe('loadWotSettings — explicit values', () => {
    it('round-trips a stored friends tier', async () => {
      await saveWotSettings({ wotTier: 'friends' });
      const settings = await loadWotSettings();
      expect(settings.wotTier).toBe('friends');
    });

    it('round-trips a stored fof tier', async () => {
      await saveWotSettings({ wotTier: 'fof' });
      const settings = await loadWotSettings();
      expect(settings.wotTier).toBe('fof');
    });

    it('round-trips a stored all tier', async () => {
      await saveWotSettings({ wotTier: 'all' });
      const settings = await loadWotSettings();
      expect(settings.wotTier).toBe('all');
    });
  });

  describe('loadWotSettings — legacy migration', () => {
    it("maps legacy filterEnabled=true → wotTier='friends'", async () => {
      // Pre-#535 stored `{ filterEnabled: boolean }`. true = filter
      // explicitly engaged = the equivalent of the friends-only tier.
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ filterEnabled: true }));
      const settings = await loadWotSettings();
      expect(settings.wotTier).toBe('friends');
    });

    it("maps legacy filterEnabled=false → wotTier='all'", async () => {
      // false = filter explicitly disengaged = the equivalent of 'all'.
      // This migration was correct pre-#627 and remains correct now.
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ filterEnabled: false }));
      const settings = await loadWotSettings();
      expect(settings.wotTier).toBe('all');
    });
  });
});
