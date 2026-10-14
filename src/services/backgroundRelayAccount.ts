import { loadIdentities } from './identitiesStore';
import { getCurrentUserPubkey, setCurrentUserPubkey } from './nostrActiveAccount';

/** Headless hosts have no provider to initialise relay lockdown. Fail closed. */
export async function initialiseBackgroundRelayAccount(): Promise<string | null> {
  const before = getCurrentUserPubkey();
  const blob = await loadIdentities().catch(() => null);
  // A foreground account switch during storage access owns the newer mirror.
  if (getCurrentUserPubkey() !== before) return null;
  const pubkey = blob?.activePubkey?.toLowerCase();
  if (!pubkey || !/^[0-9a-f]{64}$/.test(pubkey)) return null;
  setCurrentUserPubkey(pubkey);
  return pubkey;
}
