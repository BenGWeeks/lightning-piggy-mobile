// Restore the Marmot (MLS) session with no React tree mounted (#1300): the
// live-location background task can run after Android recreated the process
// for it, and Marmot shares need the session to send their updates.
//
// Mirrors MarmotBridge's startup — same options, same start() (which defers
// remote-signer key-package prompts by design) — but only for the account that
// is still the ACTIVE one, read from the same SecureStore slots NostrContext
// hydrates from. When the UI mounts later, MarmotBridge's own session replaces
// this one (setMarmotSession stops the previous session).

import * as SecureStore from 'expo-secure-store';
import { PUBKEY_KEY, SIGNER_TYPE_KEY } from '../contexts/nostrAuthKeys';
import type { SignerType } from '../types/nostr';
import { RELAY_LIST_INDEXERS } from '../utils/relayListEvents';
import { getMarmotSession, MarmotSession, setMarmotSession } from './marmotSession';
import { DEFAULT_RELAYS } from './nostrService';

const SIGNER_TYPES: readonly string[] = ['nsec', 'amber', 'nip46'];

/**
 * The owner's running Marmot session, starting one if none is running.
 * Resolves null — never a session for another account — when `owner` is no
 * longer the active account or the stored identity can't be read.
 */
export async function restoreMarmotSessionHeadless(
  owner: string,
  writeRelays: string[],
): Promise<MarmotSession | null> {
  const me = owner.toLowerCase();
  const running = getMarmotSession();
  if (running) return running.pubkey.toLowerCase() === me ? running : null;
  try {
    const [pubkey, signerType] = await Promise.all([
      SecureStore.getItemAsync(PUBKEY_KEY),
      SecureStore.getItemAsync(SIGNER_TYPE_KEY),
    ]);
    if (pubkey?.toLowerCase() !== me || !signerType || !SIGNER_TYPES.includes(signerType)) {
      return null;
    }
    const session = new MarmotSession({
      pubkey: me,
      signerType: signerType as SignerType,
      getWriteRelays: () => (writeRelays.length > 0 ? writeRelays : DEFAULT_RELAYS),
      getLookupRelays: () => [
        ...new Set([...writeRelays, ...RELAY_LIST_INDEXERS, ...DEFAULT_RELAYS]),
      ],
    });
    setMarmotSession(session);
    session.start().catch((e) => {
      if (__DEV__) console.warn('[LiveLocation] headless Marmot start failed:', e);
    });
    if (__DEV__) console.log('[LiveLocation] restored the Marmot session headlessly');
    return session;
  } catch {
    return null;
  }
}
