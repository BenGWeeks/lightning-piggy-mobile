import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useLocales } from 'expo-localization';
import type { Scope, TranslateOptions } from 'i18n-js';
import i18n, {
  SUPPORTED_LOCALES,
  isSupportedLocale,
  createI18nInstance,
  type SupportedLocale,
} from '../i18n';

import { useActivePubkey } from '../hooks/useActivePubkey';
import { useAccountState } from './useAccountState';
import {
  LOCALE_PREF_KEY_BASE,
  loadAccountPref,
  peekAccountPref,
  saveAccountPref,
} from '../services/accountDisplayPrefs';

const isPref = (v: string | null): v is LocalePreference =>
  v === 'system' || (!!v && isSupportedLocale(v));

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
  // Language is PER ACCOUNT (shared family phone). Owner-tagged so a switch
  // never renders the previous account's language; `empty` is the account's
  // already-seen value (sync) or 'system'.
  const activePubkey = useActivePubkey();
  const seen = peekAccountPref(LOCALE_PREF_KEY_BASE, activePubkey);
  const [preference, setPreferenceState] = useAccountState<LocalePreference>(
    activePubkey,
    isPref(seen) ? seen : 'system',
  );
  // `useLocales()` re-renders this provider if the OS locale changes
  // (mirrors ThemeContext's `Appearance.addChangeListener` for 'system' mode).
  const deviceLocales = useLocales();

  const changeVersion = useRef(0);

  // Load the active account's preference (its own, else the phone default,
  // else stay on 'system' so the app follows the device locale).
  useEffect(() => {
    let mounted = true;
    const version = changeVersion.current;
    loadAccountPref(LOCALE_PREF_KEY_BASE, activePubkey).then((stored) => {
      if (mounted && version === changeVersion.current && isPref(stored))
        setPreferenceState(stored);
    });
    return () => {
      mounted = false;
    };
  }, [activePubkey, setPreferenceState]);

  const setPreference = useCallback(
    (pref: LocalePreference) => {
      changeVersion.current += 1;
      setPreferenceState(pref);
      saveAccountPref(LOCALE_PREF_KEY_BASE, pref, activePubkey).catch(() => {});
    },
    [activePubkey, setPreferenceState],
  );

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
