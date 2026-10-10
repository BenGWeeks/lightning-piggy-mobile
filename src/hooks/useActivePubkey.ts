import { useSyncExternalStore } from 'react';
import { getActivePubkey, subscribeActivePubkey } from '../services/walletStorageService';

/**
 * The active account's pubkey, readable from providers that sit ABOVE
 * NostrProvider (Locale, Wallet). Mirrors what NostrContext publishes to
 * walletStorageService, and re-renders synchronously on an account switch.
 */
export function useActivePubkey(): string | null {
  return useSyncExternalStore(subscribeActivePubkey, getActivePubkey, getActivePubkey);
}
