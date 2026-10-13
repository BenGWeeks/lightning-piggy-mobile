import { useCallback } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { useNostr } from '../contexts/NostrContext';
import { initialiseNotificationDefaults } from '../services/notificationDefaults';

/** Wallets is the first safe foreground surface for the OS permission prompt. */
export function useNotificationDefaults(): void {
  const { isLoggedIn, pubkey } = useNostr();
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
          // Focus only gates STARTING setup. Once started, the task binds
          // itself to the live account (tabs are freezeOnBlur, so nothing
          // here could be trusted after a switch) and cancels on its own.
          void initialiseNotificationDefaults(pubkey).catch((error) => {
            if (__DEV__) console.warn('[Notifications] default setup failed:', error);
          });
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
