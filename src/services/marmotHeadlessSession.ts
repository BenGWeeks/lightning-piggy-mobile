// Restore the Marmot (MLS) session with no React tree mounted (#1300): the
// live-location background task can run after Android recreated the process
// for it, and Marmot shares need the session to send their updates.
//
// Mirrors MarmotBridge's startup — same options, same start() (which defers
// remote-signer key-package prompts by design) — but only for the account that
// is still the ACTIVE one, resolved the way NostrContext hydrates it: the
// identity registry's activePubkey (nsec / Amber accounts), else the legacy
// pubkey slot (NIP-46), with the active signer type. When the UI mounts
// later, MarmotBridge's own session replaces this one (setMarmotSession stops
// the previous session).

import * as SecureStore from 'expo-secure-store';
import { PUBKEY_KEY, SIGNER_TYPE_KEY } from '../contexts/nostrAuthKeys';
import type { SignerType } from '../types/nostr';
import { RELAY_LIST_INDEXERS } from '../utils/relayListEvents';
import { getMarmotSession, MarmotSession, setMarmotSession } from './marmotSession';
import { DEFAULT_RELAYS } from './nostrService';
import { loadIdentities } from './identitiesStore';

const SIGNER_TYPES: readonly string[] = ['nsec', 'amber', 'nip46'];

// One restore at a time: the OS can deliver a burst of location events before
// the first restore has set the session, and two sessions must never run over
// the same MLS store.
let pending: Promise<MarmotSession | null> | null = null;

/**
 * The owner's running Marmot session, starting one if none is running.
 * Resolves null — never a session for another account — when `owner` is no
 * longer the active account or the stored identity can't be read.
 */
export function restoreMarmotSessionHeadless(
  owner: string,
  writeRelays: string[],
): Promise<MarmotSession | null> {
  pending ??= restore(owner, writeRelays).finally(() => {
    pending = null;
  });
  return pending;
}

async function restore(owner: string, writeRelays: string[]): Promise<MarmotSession | null> {
  const me = owner.toLowerCase();
  const running = getMarmotSession();
  if (running) return running.pubkey.toLowerCase() === me ? running : null;
  try {
    const [signerType, legacyPubkey, registry] = await Promise.all([
      SecureStore.getItemAsync(SIGNER_TYPE_KEY),
      SecureStore.getItemAsync(PUBKEY_KEY),
      loadIdentities(),
    ]);
    const active = signerType === 'nip46' ? legacyPubkey : (registry.activePubkey ?? legacyPubkey);
    if (active?.toLowerCase() !== me || !signerType || !SIGNER_TYPES.includes(signerType)) {
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
