// State machine behind the Back up your key screen (#1223): gate the key
// behind device authentication, hold it only while the screen is focused,
// block screenshots while it's in memory, and copy it with auto-clear.
//
// Security invariants:
//  - The nsec is read from SecureStore only after the gate passes, and is
//    dropped from state on blur, on app background and on unmount.
//  - It never leaves this hook except as the `nsec` value the screen
//    renders — no logs, toasts, analytics or navigation params.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ScreenCapture from 'expo-screen-capture';
import { Alert } from '../components/BrandedAlert';
import { useTranslation } from '../contexts/LocaleContext';
import {
  authenticateForKeyReveal,
  keyRevealGate,
  loadAccountNsec,
} from '../services/accountKeyAccess';
import { copySensitiveText } from '../services/sensitiveClipboard';

const SCREEN_CAPTURE_KEY = 'key-backup';

export type KeyRevealError = 'auth-failed' | 'missing' | null;

export interface KeyBackupReveal {
  /** The key, or null when locked. Only render it when `revealed`. */
  nsec: string | null;
  revealed: boolean;
  /** True once the user has unlocked the key at least once on this visit. */
  hasUnlocked: boolean;
  busy: boolean;
  error: KeyRevealError;
  toggleReveal: () => Promise<void>;
  copy: () => Promise<boolean>;
}

export function useKeyBackupReveal(pubkey: string | null): KeyBackupReveal {
  const t = useTranslation();
  const [nsec, setNsec] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [hasUnlocked, setHasUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<KeyRevealError>(null);
  // Guards against a slow auth / SecureStore read landing after blur.
  const focusedRef = useRef(false);

  const lock = useCallback(() => {
    setNsec(null);
    setRevealed(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      // Background (not 'inactive' — the iOS Face ID sheet and Android
      // device-credential screen pass through it mid-auth) re-locks.
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'background') lock();
      });
      return () => {
        focusedRef.current = false;
        sub.remove();
        lock();
        setHasUnlocked(false);
        setError(null);
      };
    }, [lock]),
  );

  // Block screenshots / screen recording / the recents thumbnail while the
  // key is in memory (FLAG_SECURE on Android; app-switcher blur on iOS).
  const keyLoaded = nsec !== null;
  useEffect(() => {
    if (!keyLoaded) return;
    ScreenCapture.preventScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch(() => {});
    if (Platform.OS === 'ios') ScreenCapture.enableAppSwitcherProtectionAsync().catch(() => {});
    return () => {
      ScreenCapture.allowScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch(() => {});
      if (Platform.OS === 'ios') ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => {});
    };
  }, [keyLoaded]);

  const confirmWithoutScreenLock = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        Alert.alert(t('keyBackupScreen.noLockTitle'), t('keyBackupScreen.noLockMessage'), [
          {
            text: t('keyBackupScreen.cancel'),
            style: 'cancel',
            onPress: () => resolve(false),
            testID: 'key-backup-no-lock-cancel',
          },
          {
            text: t('keyBackupScreen.noLockConfirm'),
            style: 'destructive',
            onPress: () => resolve(true),
            testID: 'key-backup-no-lock-confirm',
          },
        ]);
      }),
    [t],
  );

  // Returns the key, running the gate first if it isn't loaded yet.
  const unlock = useCallback(async (): Promise<string | null> => {
    if (nsec) return nsec;
    if (!pubkey) return null;
    setBusy(true);
    setError(null);
    try {
      const gate = await keyRevealGate();
      const passed =
        gate === 'device-auth'
          ? await authenticateForKeyReveal({
              promptMessage: t('keyBackupScreen.authPrompt'),
              cancelLabel: t('keyBackupScreen.cancel'),
            })
          : await confirmWithoutScreenLock();
      if (!passed) {
        if (gate === 'device-auth') setError('auth-failed');
        return null;
      }
      const loaded = await loadAccountNsec(pubkey);
      if (!focusedRef.current) return null;
      if (!loaded) {
        setError('missing');
        return null;
      }
      setNsec(loaded);
      setHasUnlocked(true);
      return loaded;
    } catch {
      setError('missing');
      return null;
    } finally {
      setBusy(false);
    }
  }, [nsec, pubkey, t, confirmWithoutScreenLock]);

  const toggleReveal = useCallback(async () => {
    if (revealed) {
      setRevealed(false);
      return;
    }
    const key = await unlock();
    if (key) setRevealed(true);
  }, [revealed, unlock]);

  const copy = useCallback(async () => {
    const key = await unlock();
    if (!key) return false;
    try {
      await copySensitiveText(key);
      return true;
    } catch {
      return false;
    }
  }, [unlock]);

  return { nsec, revealed, hasUnlocked, busy, error, toggleReveal, copy };
}
