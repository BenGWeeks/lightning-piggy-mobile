import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OWN_PROFILE_CACHE_KEY_BASE } from '../contexts/NostrContext';
import { perAccountKey } from '../services/perAccountStorage';
import type { NostrProfile } from '../types/nostr';

/** Cache-only names for the Move destination profile picker. */
export function useTransferProfileNames(
  visible: boolean,
  identities: readonly { pubkey: string }[],
) {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!visible || identities.length <= 1) return;
    let cancelled = false;
    void Promise.all(
      identities.map(async ({ pubkey }) => {
        try {
          const raw = await AsyncStorage.getItem(perAccountKey(OWN_PROFILE_CACHE_KEY_BASE, pubkey));
          const profile = raw ? (JSON.parse(raw) as NostrProfile) : null;
          return [pubkey, profile?.displayName || profile?.name || ''] as const;
        } catch {
          return [pubkey, ''] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setNames(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [visible, identities]);
  return names;
}
