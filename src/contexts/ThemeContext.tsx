import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  darkPalette,
  lightPalette,
  type Palette,
  type ResolvedScheme,
  type ThemePreference,
} from '../styles/palettes';

import {
  outgoingBubblePalettes,
  resolveOutgoingBubbleStyle,
  type OutgoingBubbleStyle,
} from '../styles/outgoingBubblePalettes';

const BUBBLE_STORAGE_KEY = 'app_outgoing_bubble_style';
const STORAGE_KEY = 'app_theme_preference';

interface ThemeContextValue {
  outgoingBubbleStyle: OutgoingBubbleStyle;
  setOutgoingBubbleStyle: (style: OutgoingBubbleStyle) => void;
  preference: ThemePreference;
  scheme: ResolvedScheme;
  colors: Palette;
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveScheme(pref: ThemePreference, systemScheme: ResolvedScheme): ResolvedScheme {
  return pref === 'system' ? systemScheme : pref;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [outgoingBubbleStyle, setBubbleStyle] = useState<OutgoingBubbleStyle>('A');
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [systemScheme, setSystemScheme] = useState<ResolvedScheme>(
    Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
  );

  // Load persisted preference on mount. If nothing is stored, stay on
  // 'system' so the app follows the device setting out of the box.
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(BUBBLE_STORAGE_KEY)
      .then((stored) => {
        if (mounted) setBubbleStyle(resolveOutgoingBubbleStyle(stored));
      })
      .catch(() => {});
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!mounted) return;
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreferenceState(stored);
        }
      })
      .catch(() => {
        // Failed reads fall back to the default. No surface needed.
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Track OS-level appearance changes so 'system' mode follows the device
  // when the user flips it in settings (or via automatic night shift).
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => sub.remove();
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref).catch(() => {
      // Best-effort persistence; the in-memory change has already taken effect.
    });
  }, []);

  const setOutgoingBubbleStyle = useCallback((style: OutgoingBubbleStyle) => {
    setBubbleStyle(style);
    AsyncStorage.setItem(BUBBLE_STORAGE_KEY, style).catch(() => {});
  }, []);

  const scheme = resolveScheme(preference, systemScheme);
  const colors = useMemo(
    () => ({
      ...(scheme === 'dark' ? darkPalette : lightPalette),
      outgoingBubble: outgoingBubblePalettes[outgoingBubbleStyle],
    }),
    [scheme, outgoingBubbleStyle],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      scheme,
      colors,
      setPreference,
      outgoingBubbleStyle,
      setOutgoingBubbleStyle,
    }),
    [preference, scheme, colors, setPreference, outgoingBubbleStyle, setOutgoingBubbleStyle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

export function useThemeColors(): Palette {
  return useTheme().colors;
}
