// State machine behind the Back up your key screen (#1223): gate the key
// behind device authentication, hold it only while the screen is focused,
// block screenshots for the screen's whole focused lifetime, and copy it
// through the platform's secret clipboard.
//
// Security invariants:
//  - The nsec is read from SecureStore only after the gate passes, and is
//    dropped from state on blur, on app background and on unmount.
//  - Screen-capture protection is requested on focus, before the key can
//    load, and a reveal waits for it to settle; if it failed, the user is
//    warned before the key is shown.
//  - It never leaves this hook except as the `nsec` value the screen
//    renders — no logs, toasts, analytics or navigation params.
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
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
  const [loadedKey, setLoadedKey] = useState<{ pubkey: string; nsec: string } | null>(null);
  const nsec = loadedKey?.pubkey === pubkey ? loadedKey.nsec : null;
  const [revealed, setRevealed] = useState(false);
  const hasUnlocked = nsec !== null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<KeyRevealError>(null);
  // Guards against a slow auth / SecureStore read landing after blur.
  const focusedRef = useRef(false);
  const generationRef = useRef(0);
  const unlockingRef = useRef(false);
  const authenticatingRef = useRef(false);
  const foregroundWaitRef = useRef<((active: boolean) => void) | null>(null);
  // Resolves true once capture protection is on for this focus, false if
  // the platform refused it (or the screen isn't protecting anything).
  const protectionRef = useRef<Promise<boolean>>(Promise.resolve(false));

  const lock = useCallback(() => {
    generationRef.current += 1;
    unlockingRef.current = false;
    authenticatingRef.current = false;
    foregroundWaitRef.current?.(false);
    foregroundWaitRef.current = null;
    setLoadedKey(null);
    setBusy(false);
    setError(null);
    setRevealed(false);
  }, []);

  // Invalidate before interaction with new route params, including account removal.
  useLayoutEffect(lock, [pubkey, lock]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      // Android 7–10 opens the PIN/pattern prompt in a separate activity,
      // which reports background (not inactive). Keep only that pending
      // authentication alive; no key is read until the app is active again.
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'background' && !authenticatingRef.current) lock();
        if (state === 'active') {
          foregroundWaitRef.current?.(true);
          foregroundWaitRef.current = null;
        }
      });
      return () => {
        focusedRef.current = false;
        sub.remove();
        lock();
      };
    }, [lock]),
  );

  // Block screenshots / screen recording / the recents thumbnail for as long
  // as a local-key screen is focused (FLAG_SECURE on Android; capture block
  // + app-switcher blur on iOS) — not just once the key has loaded, so no
  // frame showing the key can ever be painted before protection is asked
  // for. Keyed on having a key to protect, not on which account it is.
  const protect = pubkey !== null;
  useFocusEffect(
    useCallback(() => {
      if (!protect) {
        protectionRef.current = Promise.resolve(false);
        return;
      }
      const enable = async () => {
        await ScreenCapture.preventScreenCaptureAsync(SCREEN_CAPTURE_KEY);
        if (Platform.OS === 'ios') await ScreenCapture.enableAppSwitcherProtectionAsync();
      };
      protectionRef.current = enable().then(
        () => true,
        () => false,
      );
      return () => {
        protectionRef.current = Promise.resolve(false);
        ScreenCapture.allowScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch(() => {});
        if (Platform.OS === 'ios')
          ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => {});
      };
    }, [protect]),
  );

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

  const confirmUnprotectedReveal = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        Alert.alert(
          t('keyBackupScreen.unprotectedTitle'),
          t('keyBackupScreen.unprotectedMessage'),
          [
            {
              text: t('keyBackupScreen.cancel'),
              style: 'cancel',
              onPress: () => resolve(false),
              testID: 'key-backup-unprotected-cancel',
            },
            {
              text: t('keyBackupScreen.unprotectedConfirm'),
              style: 'destructive',
              onPress: () => resolve(true),
              testID: 'key-backup-unprotected-confirm',
            },
          ],
        );
      }),
    [t],
  );

  // Returns the key, running the gate first if it isn't loaded yet.
  const unlock = useCallback(async (): Promise<string | null> => {
    if (!pubkey || !focusedRef.current || unlockingRef.current) return null;
    if (nsec) return nsec;
    const generation = generationRef.current;
    const isCurrent = () => focusedRef.current && generationRef.current === generation;
    unlockingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const gate = await keyRevealGate();
      if (!isCurrent()) return null;
      let passed: boolean;
      if (gate === 'device-auth') {
        authenticatingRef.current = true;
        passed = await authenticateForKeyReveal({
          promptMessage: t('keyBackupScreen.authPrompt'),
          cancelLabel: t('keyBackupScreen.cancel'),
        });
        if (passed && isCurrent() && AppState.currentState !== 'active') {
          passed = await new Promise<boolean>((resolve) => {
            foregroundWaitRef.current = resolve;
          });
        }
        if (isCurrent()) authenticatingRef.current = false;
      } else {
        passed = await confirmWithoutScreenLock();
      }
      if (!isCurrent()) return null;
      if (!passed) {
        if (gate === 'device-auth') setError('auth-failed');
        return null;
      }
      const loaded = await loadAccountNsec(pubkey);
      if (!isCurrent()) return null;
      if (!loaded) {
        setError('missing');
        return null;
      }
      setLoadedKey({ pubkey, nsec: loaded });
      return loaded;
    } catch {
      if (isCurrent()) setError('missing');
      return null;
    } finally {
      if (isCurrent()) {
        authenticatingRef.current = false;
        unlockingRef.current = false;
        setBusy(false);
      }
    }
  }, [nsec, pubkey, t, confirmWithoutScreenLock]);

  const toggleReveal = useCallback(async () => {
    if (revealed) {
      setRevealed(false);
      return;
    }
    const generation = generationRef.current;
    const isCurrent = () => focusedRef.current && generationRef.current === generation;
    // Never show the key before capture protection has settled; if the
    // platform refused it, say so before going any further.
    const isProtected = await protectionRef.current;
    if (!isCurrent()) return;
    if (!isProtected && !(await confirmUnprotectedReveal())) return;
    if (!isCurrent()) return;
    const key = await unlock();
    if (key && isCurrent()) setRevealed(true);
  }, [revealed, unlock, confirmUnprotectedReveal]);

  const copy = useCallback(async () => {
    const generation = generationRef.current;
    const key = await unlock();
    if (!key || !focusedRef.current || generationRef.current !== generation) return false;
    try {
      await copySensitiveText(key);
      return true;
    } catch {
      return false;
    }
  }, [unlock]);

  return { nsec, revealed: !!nsec && revealed, hasUnlocked, busy, error, toggleReveal, copy };
}
