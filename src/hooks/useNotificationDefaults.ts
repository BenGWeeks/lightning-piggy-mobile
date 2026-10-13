import { useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { useNostr } from '../contexts/NostrContext';
import { initialiseNotificationDefaults } from '../services/notificationDefaults';

/** Wallets is the first safe foreground surface for the OS permission prompt. */
export function useNotificationDefaults(): void {
  const { isLoggedIn, pubkey } = useNostr();
  const active = useRef(pubkey);
  active.current = isLoggedIn ? pubkey : null;
  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn || !pubkey) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          // Wallets can remain focused behind an external signer or while
          // the phone is locked. Wait for a foreground resume to ask the OS.
          if (AppState.currentState !== 'active') return;
          // Focus gates starting setup; once started, only account changes cancel it.
          void initialiseNotificationDefaults(pubkey, () => active.current === pubkey).catch(
            (error) => {
              if (__DEV__) console.warn('[Notifications] default setup failed:', error);
            },
          );
        }, 3000);
      };
      schedule();
      const subscription = AppState.addEventListener('change', (state) => {
        if (timer) clearTimeout(timer);
        if (state === 'active') schedule();
      });
      return () => {
        if (timer) clearTimeout(timer);
        subscription.remove();
      };
    }, [isLoggedIn, pubkey]),
  );
}
