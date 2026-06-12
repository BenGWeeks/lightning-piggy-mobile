import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Which animation the payment/DM send overlay shows while a payment is in
// flight. Mirrors ThemeContext exactly: persisted in AsyncStorage, hydrated
// on mount with validation, best-effort writes.
export type SendingAnimationPreference = 'bubbles' | 'lightning';

export const SENDING_ANIMATION_STORAGE_KEY = 'app_sending_animation_preference';
export const DEFAULT_SENDING_ANIMATION: SendingAnimationPreference = 'bubbles';

// Single source of truth for what counts as a valid stored value — reused by
// the hydration guard and exercised directly in tests.
export function isSendingAnimationPreference(value: unknown): value is SendingAnimationPreference {
  return value === 'bubbles' || value === 'lightning';
}

interface SendingAnimationContextValue {
  preference: SendingAnimationPreference;
  setPreference: (pref: SendingAnimationPreference) => void;
}

const SendingAnimationContext = createContext<SendingAnimationContextValue | null>(null);

export const SendingAnimationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreferenceState] =
    useState<SendingAnimationPreference>(DEFAULT_SENDING_ANIMATION);

  // Load the persisted preference on mount. Anything unrecognised (or a read
  // failure) leaves us on the 'bubbles' default — the current behaviour.
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(SENDING_ANIMATION_STORAGE_KEY)
      .then((stored) => {
        if (!mounted) return;
        if (isSendingAnimationPreference(stored)) {
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

  const setPreference = useCallback((pref: SendingAnimationPreference) => {
    setPreferenceState(pref);
    AsyncStorage.setItem(SENDING_ANIMATION_STORAGE_KEY, pref).catch(() => {
      // Best-effort persistence; the in-memory change has already taken effect.
    });
  }, []);

  const value = useMemo<SendingAnimationContextValue>(
    () => ({ preference, setPreference }),
    [preference, setPreference],
  );

  return (
    <SendingAnimationContext.Provider value={value}>{children}</SendingAnimationContext.Provider>
  );
};

export function useSendingAnimation(): SendingAnimationContextValue {
  const ctx = useContext(SendingAnimationContext);
  if (!ctx) {
    throw new Error('useSendingAnimation must be used within a SendingAnimationProvider');
  }
  return ctx;
}
