import * as SecureStore from 'expo-secure-store';
import { decode } from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';
import {
  NSEC_KEY,
  PUBKEY_KEY,
  SIGNER_TYPE_KEY,
  NIP46_CONNECTION_KEY,
} from '../contexts/nostrAuthKeys';
import { isValidNip46Connection } from '../utils/nip46Connection';
import { loadIdentities } from './identitiesStore';
import { getCurrentUserPubkey, setCurrentUserPubkey } from './nostrActiveAccount';

/** Read the foreground's persisted source without starting a signer or relay. */
async function persistedForegroundPubkey(): Promise<string | null> {
  const signer = await SecureStore.getItemAsync(SIGNER_TYPE_KEY);
  if (signer === 'nip46') {
    const raw = await SecureStore.getItemAsync(NIP46_CONNECTION_KEY);
    const connection: unknown = raw ? JSON.parse(raw) : null;
    return isValidNip46Connection(connection) ? connection.userPubkey : null;
  }
  if (signer === 'amber') return SecureStore.getItemAsync(PUBKEY_KEY);
  if (signer === 'nsec') {
    const nsec = await SecureStore.getItemAsync(NSEC_KEY);
    if (!nsec) return null;
    const decoded = decode(nsec);
    return decoded.type === 'nsec' ? getPublicKey(decoded.data) : null;
  }
  // Registry-only legacy installs; never use a stale registry over a signer.
  return signer ? null : (await loadIdentities()).activePubkey;
}

/** DEV-only headless routing hydration. A live foreground account always owns the mirror. */
export async function initialiseBackgroundRelayAccount(): Promise<string | null> {
  if (!__DEV__) return null;
  const before = getCurrentUserPubkey();
  if (before) return before;
  const stored = await persistedForegroundPubkey().catch(() => null);
  // A foreground login/switch during storage access owns the newer mirror.
  const current = getCurrentUserPubkey();
  if (current) return current;
  const pubkey = stored?.toLowerCase();
  if (!pubkey || !/^[0-9a-f]{64}$/.test(pubkey)) return null;
  setCurrentUserPubkey(pubkey);
  return pubkey;
}
