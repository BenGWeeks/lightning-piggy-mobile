import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocales } from 'expo-localization';
import type { Scope, TranslateOptions } from 'i18n-js';
import i18n, { SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale } from '../i18n';

const STORAGE_KEY = 'app_locale_preference';

export type LocalePreference = 'system' | SupportedLocale;

interface LocaleContextValue {
  preference: LocalePreference;
  /** Resolved, always one of SUPPORTED_LOCALES — 'system' already folded in. */
  locale: SupportedLocale;
  setPreference: (pref: LocalePreference) => void;
  t: (scope: Scope, options?: TranslateOptions) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function resolveLocale(
  pref: LocalePreference,
  deviceLanguageCode: string | null,
): SupportedLocale {
  if (pref !== 'system') return pref;
  return deviceLanguageCode && isSupportedLocale(deviceLanguageCode) ? deviceLanguageCode : 'en';
}

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreferenceState] = useState<LocalePreference>('system');
  // `useLocales()` re-renders this provider if the OS locale changes
  // (mirrors ThemeContext's `Appearance.addChangeListener` for 'system' mode).
  const deviceLocales = useLocales();

  // Load persisted preference on mount. If nothing is stored, stay on
  // 'system' so the app follows the device locale out of the box.
  React.useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!mounted) return;
        if (stored === 'system' || (stored && isSupportedLocale(stored))) {
          setPreferenceState(stored as LocalePreference);
        }
      })
      .catch(() => {
        // Failed reads fall back to the default. No surface needed.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const setPreference = useCallback((pref: LocalePreference) => {
    setPreferenceState(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref).catch(() => {
      // Best-effort persistence; the in-memory change has already taken effect.
    });
  }, []);

  const deviceLanguageCode = deviceLocales[0]?.languageCode ?? null;
  const locale = resolveLocale(preference, deviceLanguageCode);

  // Set synchronously during render, not in a useEffect: i18n-js's
  // `.locale` is plain mutable instance state, not React state, so
  // there's no re-render to wait for — but if we deferred this to an
  // effect, any child rendered in the SAME pass as a locale change would
  // read `i18n.locale` before the effect ran and briefly show the old
  // language. The provider renders before its children, so setting it
  // here guarantees every `t()` call below sees the up-to-date locale.
  i18n.locale = locale;

  const t = useCallback<LocaleContextValue['t']>(
    (scope, options) => i18n.t(scope, options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ preference, locale, setPreference, t }),
    [preference, locale, setPreference, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return ctx;
}

/** Convenience hook for components that only need the translate function. */
export function useTranslation(): LocaleContextValue['t'] {
  return useLocale().t;
}

export { SUPPORTED_LOCALES };
