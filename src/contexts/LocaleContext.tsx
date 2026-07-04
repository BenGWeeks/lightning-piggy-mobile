import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocales } from 'expo-localization';
import type { Scope, TranslateOptions } from 'i18n-js';
import i18n, {
  SUPPORTED_LOCALES,
  isSupportedLocale,
  createI18nInstance,
  type SupportedLocale,
} from '../i18n';

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
  useEffect(() => {
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

  // Rendered translations go through a per-locale I18n instance that's
  // local to this render (memoized, not the shared/exported `i18n`
  // singleton) — never mutate shared module state during render. React
  // can start and discard render work (StrictMode double-invoke,
  // concurrent features), and mutating a shared singleton's `.locale`
  // mid-render can leak an uncommitted value to other consumers,
  // including the non-hook `t()` export other files use. Building a
  // fresh instance keyed on `locale` keeps render pure: it's local to
  // this hook call, so nothing else can observe it half-updated.
  // (Copilot review on #957.)
  const instance = useMemo(() => createI18nInstance(locale), [locale]);

  // The shared singleton is still kept in sync, but only from an effect
  // — after commit, never during render — for non-React call sites that
  // read `i18n.locale` directly (see `t()` in src/i18n/index.ts, for a
  // future GIPHY lang hint). Nothing in the render phase depends on this.
  useEffect(() => {
    i18n.locale = locale;
  }, [locale]);

  const t = useCallback<LocaleContextValue['t']>(
    (scope, options) => instance.t(scope, options),
    [instance],
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
